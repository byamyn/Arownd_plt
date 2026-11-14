import * as Linking from "expo-linking";

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
const TURNSTILE_CHALLENGE_URL = "https://nagzoafkitfsqlcwsdau.supabase.co/functions/v1/turnstile-challenge";
const CAPTCHA_RETURN_URL = "com.arownd.app://captcha";

async function getAuthCaptchaToken(): Promise<string | undefined> {
  if (!AUTH_CAPTCHA_ENABLED) return undefined;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, token?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      subscription.remove();
      if (error) reject(error);
      else resolve(token);
    };

    const subscription = Linking.addEventListener("url", ({ url }) => {
      let callbackUrl: URL;
      try {
        callbackUrl = new URL(url);
      } catch {
        return;
      }

      if (callbackUrl.protocol !== "com.arownd.app:" || callbackUrl.hostname !== "captcha") return;
      const token = callbackUrl.searchParams.get("token");
      if (!token) {
        finish(new Error("AUTH_CAPTCHA_TOKEN_MISSING"));
        return;
      }
      finish(undefined, token);
    });

    const timeout = setTimeout(() => {
      finish(new Error("AUTH_CAPTCHA_TIMEOUT"));
    }, 180_000);

    void Linking.openURL(
      TURNSTILE_CHALLENGE_URL + "?return_url=" + encodeURIComponent(CAPTCHA_RETURN_URL)
    ).catch((error: unknown) => {
      finish(error instanceof Error ? error : new Error("AUTH_CAPTCHA_OPEN_FAILED"));
    });
  });
}

export async function signIn(input: LoginInput): Promise<void> {
  assertActionRateLimit("auth:sign-in", 1_500);
  const captchaToken = await getAuthCaptchaToken();
  const { data, error } = await getSupabaseClient().auth.signInWithPassword({
    email: input.email,
    password: input.password,
    ...(captchaToken ? { options: { captchaToken } } : {})
  });

  if (error) throw error;
  if (data.user) {
    await syncSelectedCountryCodeFromProfile(data.user.id);
  }
}

export async function signUpPersonal(input: PersonalSignupInput): Promise<boolean> {
  assertActionRateLimit("auth:sign-up", 10_000);
  const countryCode = await getSelectedCountryCode();
  if (!countryCode) throw new Error("COUNTRY_NOT_SELECTED");

  const inviteCode = await getPendingInviteCode();
  const captchaToken = await getAuthCaptchaToken();
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
  await clearPendingInviteCode().catch(() => undefined);
  return data.session !== null;
}

export async function signUpBusiness(input: BusinessSignupInput): Promise<boolean> {
  assertActionRateLimit("auth:sign-up", 10_000);
  const countryCode = await getSelectedCountryCode();
  if (!countryCode) throw new Error("COUNTRY_NOT_SELECTED");

  const inviteCode = await getPendingInviteCode();
  const captchaToken = await getAuthCaptchaToken();
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
  await clearPendingInviteCode().catch(() => undefined);
  return data.session !== null;
}

export async function requestPasswordRecovery(input: RecoveryInput): Promise<void> {
  assertActionRateLimit("auth:password-recovery", 60_000);
  const captchaToken = await getAuthCaptchaToken();
  const redirectTo = Linking.createURL("reset-password", {
    scheme: "com.arownd.app"
  });

  const { error } = await getSupabaseClient().auth.resetPasswordForEmail(input.email, {
    redirectTo,
    ...(captchaToken ? { captchaToken } : {})
  });

  if (error) throw error;
}
