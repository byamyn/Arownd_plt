import "jsr:@supabase/functions-js/edge-runtime.d.ts";

async function hasValidWebhookSecret(provided: string | null, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided ?? "")),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const providedBytes = new Uint8Array(providedDigest);
  const expectedBytes = new Uint8Array(expectedDigest);
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= providedBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

function base64Url(input: Uint8Array): string {
  let binary = "";
  for (const byte of input) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToBytes(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const raw = atob(body);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function getGoogleAccessToken(serviceAccount: {
  client_email: string;
  private_key: string;
  token_uri?: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = base64Url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: serviceAccount.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: serviceAccount.token_uri || "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)),
  );
  const assertion = `${unsigned}.${base64Url(signature)}`;
  const tokenResponse = await fetch(serviceAccount.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const tokenBody = await tokenResponse.json();
  if (!tokenResponse.ok || typeof tokenBody.access_token !== "string") {
    throw new Error("Google OAuth token exchange failed");
  }
  return tokenBody.access_token;
}

function toFcmData(record: Record<string, unknown>): Record<string, string> {
  const source =
    record.data && typeof record.data === "object"
      ? (record.data as Record<string, unknown>)
      : {};
  const data: Record<string, string> = {
    notification_id: String(record.id ?? ""),
    type: String(record.type ?? "info"),
  };
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      data[key] = String(value);
    }
  }
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const webhookSecret = Deno.env.get("PUSH_WEBHOOK_SECRET");
  if (!webhookSecret || !(await hasValidWebhookSecret(req.headers.get("x-push-webhook-secret"), webhookSecret))) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const payload = await req.json();
    const record = payload?.record as Record<string, unknown> | undefined;
    const userId = typeof record?.user_id === "string" ? record.user_id : null;
    if (!record || !userId) {
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const serviceAccountRaw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceAccountRaw || !supabaseUrl || !serviceRoleKey) {
      throw new Error("Push sender secrets are not configured");
    }
    const serviceAccount = JSON.parse(serviceAccountRaw);
    const projectId = serviceAccount.project_id;
    if (!projectId) throw new Error("Firebase service account has no project_id");

    const restHeaders = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    };
    const devicesResponse = await fetch(
      `${supabaseUrl}/rest/v1/push_device_tokens?user_id=eq.${encodeURIComponent(userId)}&select=token`,
      { headers: restHeaders },
    );
    if (!devicesResponse.ok) throw new Error("Could not load registered push devices");
    const devices = (await devicesResponse.json()) as Array<{ token: string }>;
    if (!devices.length) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const accessToken = await getGoogleAccessToken(serviceAccount);
    const data = toFcmData(record);
    const results: boolean[] = new Array(devices.length).fill(false);
    let nextDeviceIndex = 0;
    const workerCount = Math.min(5, devices.length);

    const sendWorker = async (): Promise<void> => {
      while (true) {
        const deviceIndex = nextDeviceIndex;
        nextDeviceIndex += 1;
        if (deviceIndex >= devices.length) return;

        const { token } = devices[deviceIndex];
        const response = await fetch(
          `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: {
                token,
                notification: {
                  title: String(record.title || "Arownd"),
                  body: String(record.body || "لديك إشعار جديد."),
                },
                data,
                android: { priority: "high", notification: { channel_id: "arownd_updates" } },
              },
            }),
          },
        );

        if (!response.ok) {
          const failure = await response.text();
          if (failure.includes("UNREGISTERED") || failure.includes("registration-token-not-registered")) {
            await fetch(
              `${supabaseUrl}/rest/v1/push_device_tokens?token=eq.${encodeURIComponent(token)}`,
              { method: "DELETE", headers: restHeaders },
            );
          }
          results[deviceIndex] = false;
          continue;
        }
        results[deviceIndex] = true;
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => sendWorker()));

    return new Response(JSON.stringify({ sent: results.filter(Boolean).length, total: devices.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[send-push-notification]", error);
    return new Response(JSON.stringify({ error: "Push delivery failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
