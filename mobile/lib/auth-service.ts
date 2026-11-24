import * as Linking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { saveAccountSession } from "@/lib/saved-accounts";

import { getSelectedCountryCode, syncSelectedCountryCodeFromProfile } from "@/lib/country-service";
import { clearPendingInviteCode, getPendingInviteCode } from "@/lib/invite-service";

import { getSupabaseClient } from "@/lib/supabase";
import type { Session, User } from "@supabase/supabase-js";
import { assertActionRateLimit } from "@/lib/action-rate-limit";
import type {
  BusinessSignupInput,
  LoginInput,
  PersonalSignupInput,
  RecoveryInput
} from "@/lib/auth-validation";

const AI_TOUR_PENDING_PREFIX = "arownd:ai-tour:pending:";

async function submitSignup(input: {
  email: string;
  password: string;
  redirectTo: string;
  data: Record<string, string>;
}): Promise<{ user: User | null; session: Session | null }> {
  const { data, error } = await getSupabaseClient().auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: input.redirectTo,
      data: input.data
    }
  });
  if (error) throw error;
  return { user: data.user, session: data.session };
}

export async function signIn(input: LoginInput): Promise<void> {
  assertActionRateLimit("auth:sign-in", 1_500);
  const { data, error } = await getSupabaseClient().auth.signInWithPassword({
    email: input.email,
    password: input.password
  });

  if (error) throw error;
  if (data.session) await saveAccountSession(data.session).catch(() => undefined);
  if (data.user) {
    await syncSelectedCountryCodeFromProfile(data.user.id);
  }
}

export async function signUpPersonal(input: PersonalSignupInput): Promise<boolean> {
  assertActionRateLimit("auth:sign-up", 10_000);
  const { data: usernameAvailable, error: usernameError } = await getSupabaseClient().rpc("is_username_available", { _username: input.username });
  if (usernameError) throw usernameError;
  if (usernameAvailable !== true) throw new Error("USERNAME_TAKEN");
  const countryCode = await getSelectedCountryCode();
  if (!countryCode) throw new Error("COUNTRY_NOT_SELECTED");

  const inviteCode = await getPendingInviteCode();
  const redirectTo = Linking.createURL("auth/callback", {
    scheme: "com.arownd.app"
  });

  const data = await submitSignup({
    email: input.email,
    password: input.password,
    redirectTo,
    data: {
      username: input.username,
      full_name: input.username,
      account_type: "personal",
      country_code: countryCode,
      ...(inviteCode ? { invite_code: inviteCode } : {})
    }
  });

  if (data.session) await saveAccountSession(data.session);
  if (data.user) await AsyncStorage.setItem(AI_TOUR_PENDING_PREFIX + data.user.id, "1").catch(() => undefined);
  await clearPendingInviteCode().catch(() => undefined);
  return data.session !== null;
}

export async function signUpBusiness(input: BusinessSignupInput): Promise<boolean> {
  assertActionRateLimit("auth:sign-up", 10_000);
  const { data: usernameAvailable, error: usernameError } = await getSupabaseClient().rpc("is_username_available", { _username: input.username });
  if (usernameError) throw usernameError;
  if (usernameAvailable !== true) throw new Error("USERNAME_TAKEN");
  const countryCode = await getSelectedCountryCode();
  if (!countryCode) throw new Error("COUNTRY_NOT_SELECTED");

  const inviteCode = await getPendingInviteCode();
  const redirectTo = Linking.createURL("auth/callback", {
    scheme: "com.arownd.app"
  });

  const data = await submitSignup({
    email: input.email,
    password: input.password,
    redirectTo,
    data: {
      username: input.username,
      full_name: input.username,
      account_type: "merchant",
      country_code: countryCode,
      business_name: input.businessName.trim(),
      ...(inviteCode ? { invite_code: inviteCode } : {})
    }
  });

  if (data.session) await saveAccountSession(data.session);
  if (data.user) await AsyncStorage.setItem(AI_TOUR_PENDING_PREFIX + data.user.id, "1");
  await clearPendingInviteCode().catch(() => undefined);
  return data.session !== null;
}

export async function requestPasswordRecovery(input: RecoveryInput): Promise<void> {
  assertActionRateLimit("auth:password-recovery", 60_000);
  const redirectTo = Linking.createURL("reset-password", {
    scheme: "com.arownd.app"
  });

  const { error } = await getSupabaseClient().auth.resetPasswordForEmail(input.email, {
    redirectTo
  });

  if (error) throw error;
}
