import * as Linking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { requestAuthCaptchaToken } from "@/lib/auth-captcha";
import { saveAccountSession } from "@/lib/saved-accounts";

import { getSelectedCountryCode, syncSelectedCountryCodeFromProfile } from "@/lib/country-service";
import { clearPendingInviteCode, getPendingInviteCode } from "@/lib/invite-service";

import { getSupabaseClient } from "@/lib/supabase";
import { assertActionRateLimit } from "@/lib/action-rate-limit";
import type {
  BusinessSignupInput,
  LoginInput,
  PersonalSignupInput,
  RecoveryInput
} from "@/lib/auth-validation";

const AUTH_CAPTCHA_ENABLED = process.env.EXPO_PUBLIC_AUTH_CAPTCHA_ENABLED === "true";
const AI_TOUR_PENDING_PREFIX = "arownd:ai-tour:pending:";
async function getSignupCaptchaToken(): Promise<string | undefined> {
  if (!AUTH_CAPTCHA_ENABLED) return undefined;
  return requestAuthCaptchaToken();
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
  const countryCode = await getSelectedCountryCode();
  if (!countryCode) throw new Error("COUNTRY_NOT_SELECTED");

  const inviteCode = await getPendingInviteCode();
  const captchaToken = await getSignupCaptchaToken();
  const redirectTo = Linking.createURL("auth/callback", {
    scheme: "com.arownd.app"
  });

  const { data, error } = await getSupabaseClient().auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: redirectTo,
      ...(captchaToken ? { captchaToken } : {}),
      data: {
        full_name: input.fullName.trim(),
        account_type: "personal",
        country_code: countryCode,
        ...(inviteCode ? { invite_code: inviteCode } : {})
      }
    }
  });

  if (error) throw error;
  if (data.session) await saveAccountSession(data.session);
  if (data.user) await AsyncStorage.setItem(AI_TOUR_PENDING_PREFIX + data.user.id, "1").catch(() => undefined);
  await clearPendingInviteCode().catch(() => undefined);
  return data.session !== null;
}

export async function signUpBusiness(input: BusinessSignupInput): Promise<boolean> {
  assertActionRateLimit("auth:sign-up", 10_000);
  const countryCode = await getSelectedCountryCode();
  if (!countryCode) throw new Error("COUNTRY_NOT_SELECTED");

  const inviteCode = await getPendingInviteCode();
  const captchaToken = await getSignupCaptchaToken();
  const redirectTo = Linking.createURL("auth/callback", {
    scheme: "com.arownd.app"
  });

  const { data, error } = await getSupabaseClient().auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: redirectTo,
      ...(captchaToken ? { captchaToken } : {}),
      data: {
        full_name: input.fullName.trim(),
        account_type: "merchant",
        country_code: countryCode,
        business_name: input.businessName.trim(),
        ...(inviteCode ? { invite_code: inviteCode } : {})
      }
    }
  });

  if (error) throw error;
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
