import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type SignupBody = {
  email?: unknown;
  password?: unknown;
  redirectTo?: unknown;
  captchaToken?: unknown;
  data?: unknown;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSignupData(value: unknown): value is {
  full_name: string;
  account_type: "personal" | "merchant";
  country_code: string;
  business_name?: string;
  invite_code?: string;
} {
  if (!isRecord(value)) return false;
  if (typeof value.full_name !== "string" || value.full_name.trim().length < 2 || value.full_name.length > 120) return false;
  if (value.account_type !== "personal" && value.account_type !== "merchant") return false;
  if (typeof value.country_code !== "string" || !/^[A-Z]{2,3}$/.test(value.country_code)) return false;
  if (value.account_type === "merchant" &&
      (typeof value.business_name !== "string" || value.business_name.trim().length < 2 || value.business_name.length > 160)) return false;
  if (value.invite_code !== undefined &&
      (typeof value.invite_code !== "string" || value.invite_code.length > 80)) return false;
  return true;
}

async function verifyTurnstile(token: string, secret: string, expectedHostname: string): Promise<boolean> {
  const form = new URLSearchParams({ secret, response: token });
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!response.ok) return false;

  const result = await response.json() as {
    success?: boolean;
    hostname?: string;
  };
  return result.success === true && result.hostname === expectedHostname;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
    const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY")?.trim() ?? "";
    const publishableKeysRaw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "";
    if (!supabaseUrl || !turnstileSecret || !publishableKeysRaw) {
      console.error("[signup-with-turnstile] Required server configuration is missing");
      return jsonResponse({ error: "Signup verification is not configured" }, 503);
    }

    const publishableKeys = JSON.parse(publishableKeysRaw) as Record<string, string>;
    const publishableKey = publishableKeys.default;
    if (!publishableKey) {
      return jsonResponse({ error: "Signup verification is not configured" }, 503);
    }

    const body = await request.json() as SignupBody;
    if (
      typeof body.email !== "string" ||
      body.email.trim().length < 3 ||
      body.email.length > 254 ||
      typeof body.password !== "string" ||
      body.password.length < 8 ||
      body.password.length > 256 ||
      typeof body.redirectTo !== "string" ||
      typeof body.captchaToken !== "string" ||
      body.captchaToken.length < 20 ||
      body.captchaToken.length > 4096 ||
      !validSignupData(body.data)
    ) {
      return jsonResponse({ error: "Invalid signup request" }, 400);
    }

    let redirectUrl: URL;
    try {
      redirectUrl = new URL(body.redirectTo);
    } catch {
      return jsonResponse({ error: "Invalid signup redirect" }, 400);
    }
    if (redirectUrl.protocol !== "com.arownd.app:") {
      return jsonResponse({ error: "Invalid signup redirect" }, 400);
    }

    const expectedHostname = new URL(supabaseUrl).hostname;
    const verified = await verifyTurnstile(body.captchaToken, turnstileSecret, expectedHostname);
    if (!verified) {
      return jsonResponse({ error: "CAPTCHA verification failed" }, 400);
    }

    const supabase = createClient(supabaseUrl, publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { data, error } = await supabase.auth.signUp({
      email: body.email.trim(),
      password: body.password,
      options: {
        emailRedirectTo: body.redirectTo,
        data: body.data,
      },
    });

    if (error) {
      return jsonResponse({ error: error.message }, 400);
    }

    return jsonResponse({ user: data.user, session: data.session });
  } catch (error) {
    console.error("[signup-with-turnstile] Request failed", error);
    return jsonResponse({ error: "Signup request failed" }, 500);
  }
});
