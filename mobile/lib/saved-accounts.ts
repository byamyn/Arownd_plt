import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { Session } from "@supabase/supabase-js";

import { getSupabaseClient } from "@/lib/supabase";
import { syncSelectedCountryCodeFromProfile } from "@/lib/country-service";

const SAVED_ACCOUNTS_KEY = "arownd:saved-accounts:v1";
const SESSION_KEY_PREFIX = "arownd:saved-account-session:v1:";

let accountStorageQueue: Promise<void> = Promise.resolve();

function runSerially<T>(operation: () => Promise<T>): Promise<T> {
  const result = accountStorageQueue.then(operation, operation);
  accountStorageQueue = result.then(() => undefined, () => undefined);
  return result;
}

export type SavedAccount = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  lastUsedAt: string;
};

export type StoredAccountSession = {
  userId: string;
  access_token: string;
  refresh_token: string;
};

export type SavedAccountsSnapshot = {
  accounts: SavedAccount[];
  currentUserId: string | null;
};

function getSessionStorageKey(userId: string): string {
  return SESSION_KEY_PREFIX + userId;
}

async function readSavedAccountsIndex(): Promise<SavedAccount[]> {
  const raw = await AsyncStorage.getItem(SAVED_ACCOUNTS_KEY);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((account): account is SavedAccount => (
      typeof account === "object" &&
      account !== null &&
      "id" in account &&
      typeof account.id === "string" &&
      "email" in account &&
      typeof account.email === "string" &&
      "displayName" in account &&
      typeof account.displayName === "string" &&
      "lastUsedAt" in account &&
      typeof account.lastUsedAt === "string"
    ));
  } catch {
    return [];
  }
}

async function persistAccountSession(session: Session): Promise<void> {
  const user = session.user;
  const email = user.email?.trim();
  if (!email) return;

  const metadata = user.user_metadata ?? {};
  const displayNameValue = metadata.full_name ?? metadata.name;
  const avatarValue = metadata.avatar_url ?? metadata.picture;
  const account: SavedAccount = {
    id: user.id,
    email,
    displayName: typeof displayNameValue === "string" && displayNameValue.trim()
      ? displayNameValue.trim()
      : email,
    avatarUrl: typeof avatarValue === "string" ? avatarValue : null,
    lastUsedAt: new Date().toISOString()
  };

  // Session tokens are stored only in the platform secure store, never in AsyncStorage.
  const storedSession: StoredAccountSession = {
    userId: user.id,
    access_token: session.access_token,
    refresh_token: session.refresh_token
  };
  await SecureStore.setItemAsync(getSessionStorageKey(user.id), JSON.stringify(storedSession));
  const accounts = await readSavedAccountsIndex();
  const nextAccounts = [account, ...accounts.filter((item) => item.id !== user.id)];
  await AsyncStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(nextAccounts));
}

export function saveAccountSession(session: Session): Promise<void> {
  return runSerially(() => persistAccountSession(session));
}

export async function saveCurrentAccountSession(): Promise<string | null> {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw error;
  if (!data.session) return null;
  await saveAccountSession(data.session);
  return data.session.user.id;
}

export async function getSavedAccountsSnapshot(): Promise<SavedAccountsSnapshot> {
  await accountStorageQueue;
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;

  const currentSession = data.session;
  if (currentSession) await saveAccountSession(currentSession);

  const indexedAccounts = await readSavedAccountsIndex();
  const accounts: SavedAccount[] = [];
  const retainedAccounts: SavedAccount[] = [];

  for (const account of indexedAccounts) {
    const rawSession = await SecureStore.getItemAsync(getSessionStorageKey(account.id));
    if (!rawSession) continue;

    try {
      const session = JSON.parse(rawSession) as StoredAccountSession;
      if (session.userId !== account.id || !session.access_token || !session.refresh_token) continue;
      accounts.push(account);
      retainedAccounts.push(account);
    } catch {
      // Ignore malformed local session records; they cannot be used to switch accounts.
    }
  }

  if (retainedAccounts.length !== indexedAccounts.length) {
    await AsyncStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(retainedAccounts));
  }

  return {
    accounts,
    currentUserId: currentSession?.user.id ?? null
  };
}

export async function switchToSavedAccount(userId: string): Promise<void> {
  const client = getSupabaseClient();
  const { data: currentData, error: currentError } = await client.auth.getSession();
  if (currentError) throw currentError;
  if (currentData.session) await saveAccountSession(currentData.session);

  const rawSession = await SecureStore.getItemAsync(getSessionStorageKey(userId));
  if (!rawSession) throw new Error("SAVED_ACCOUNT_SESSION_MISSING");

  let targetSession: StoredAccountSession;
  try {
    targetSession = JSON.parse(rawSession) as StoredAccountSession;
  } catch {
    throw new Error("SAVED_ACCOUNT_SESSION_INVALID");
  }

  if (targetSession.userId !== userId || !targetSession.access_token || !targetSession.refresh_token) {
    throw new Error("SAVED_ACCOUNT_SESSION_INVALID");
  }

  const { data, error } = await client.auth.setSession({
    access_token: targetSession.access_token,
    refresh_token: targetSession.refresh_token
  });
  if (error) throw error;
  if (!data.session || data.user?.id !== userId) {
    throw new Error("SAVED_ACCOUNT_SESSION_INVALID");
  }

  await saveAccountSession(data.session);
  await syncSelectedCountryCodeFromProfile(userId).catch(() => undefined);
}

export function removeSavedAccount(userId: string): Promise<void> {
  return runSerially(async () => {
    await SecureStore.deleteItemAsync(getSessionStorageKey(userId));
    const accounts = await readSavedAccountsIndex();
    await AsyncStorage.setItem(
      SAVED_ACCOUNTS_KEY,
      JSON.stringify(accounts.filter((account) => account.id !== userId))
    );
  });
}
