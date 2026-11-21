import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type ChatRole = "system" | "user" | "assistant";
type ChatMessage = { role: ChatRole; content: string };
type Provider = "groq" | "gemini" | "cloudflare" | "openrouter";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROVIDER_COOLDOWN_MS = 60_000;
const providerCooldowns = new Map<Provider, number>();

const SYSTEM_PROMPT = {
  ar: [
    "أنت Arownd Aide، المساعد الرسمي لمنصة Arownd.",
    "ساعد المستخدم في فهم التطبيق واستخدام Arownd Personal وArownd Business وArownd Studio.",
    "أجب بالعربية الواضحة والمباشرة. استخدم لغة هادئة ومهنية وخطوات عملية عند الحاجة.",
    "لا تدّعِ الوصول إلى حساب المستخدم أو طلباته أو مخزونه أو بيانات المتاجر أو قاعدة البيانات؛ لا تتوفر لك أدوات للوصول إليها.",
    "لا تخترع أسعاراً أو مخزوناً أو حالة طلب أو صلاحيات أو سياسات غير موجودة في سياق المحادثة.",
    "إذا كان السؤال يتطلب بيانات حساب حية أو إجراءً داخل الحساب، وضّح أن المستخدم يحتاج إلى فتح القسم المعني داخل التطبيق.",
    "إذا كان السؤال خارج نطاق Arownd، وضّح حدود دورك باختصار ثم أعد توجيهه إلى استخدام Arownd."
  ].join("\n"),
  en: [
    "You are Arownd Aide, the official assistant for the Arownd platform.",
    "Help users understand and use Arownd Personal, Arownd Business, and Arownd Studio.",
    "Answer in clear, direct English with a calm, professional tone and practical steps when useful.",
    "Never claim access to a user's account, orders, inventory, store data, or database; you have no tools to access them.",
    "Never invent prices, stock, order status, permissions, or policies that are not present in the conversation.",
    "If a question requires live account data or an account action, explain that the user must open the relevant section in the app.",
    "For questions outside Arownd, briefly state your scope and redirect the user to Arownd usage."
  ].join("\n"),
};

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders, "Cache-Control": "no-store" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractOpenAiText(payload: unknown): string | null {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return null;
  const first = payload.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) return null;
  const content = first.message.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const text = content
      .filter((part) => isRecord(part) && part.type === "text" && typeof part.text === "string")
      .map((part) => (part as { text: string }).text)
      .join("\n")
      .trim();
    return text || null;
  }
  return null;
}

function extractGeminiText(payload: unknown): string | null {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) return null;
  const candidate = payload.candidates[0];
  if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) return null;
  const text = candidate.content.parts
    .filter((part) => isRecord(part) && typeof part.text === "string")
    .map((part) => (part as { text: string }).text)
    .join("\n")
    .trim();
  return text || null;
}

function retryDelay(response: Response): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 15 * 60_000);
  }
  return PROVIDER_COOLDOWN_MS;
}

async function fetchJson(
  provider: Provider,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500 || response.status === 408) {
        providerCooldowns.set(provider, Date.now() + retryDelay(response));
      } else if (response.status === 401 || response.status === 403 || response.status === 404) {
        providerCooldowns.set(provider, Date.now() + 5 * 60_000);
      }
      throw new Error("provider_http_" + response.status);
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      providerCooldowns.set(provider, Date.now() + PROVIDER_COOLDOWN_MS);
      throw new Error("provider_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callGroq(messages: ChatMessage[]): Promise<string> {
  const key = Deno.env.get("GROQ_API_KEY")?.trim();
  if (!key) throw new Error("provider_not_configured");
  const payload = await fetchJson("groq", "https://api.groq.com/openai/v1/chat/completions", {
    Authorization: "Bearer " + key,
  }, {
    model: Deno.env.get("GROQ_MODEL")?.trim() || "openai/gpt-oss-20b",
    messages,
    temperature: 0.4,
    max_tokens: 900,
  });
  const answer = extractOpenAiText(payload);
  if (!answer) throw new Error("provider_invalid_response");
  return answer;
}

async function callGemini(messages: ChatMessage[]): Promise<string> {
  const key = Deno.env.get("GEMINI_API_KEY")?.trim();
  if (!key) throw new Error("provider_not_configured");
  const system = messages.find((message) => message.role === "system");
  const conversation = messages.filter((message) => message !== system);
  const model = Deno.env.get("GEMINI_MODEL")?.trim() || "gemini-3.1-flash-lite";
  const payload = await fetchJson("gemini",
    "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent",
    { "x-goog-api-key": key },
    {
      systemInstruction: { parts: [{ text: system?.content || "" }] },
      contents: conversation.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
      generationConfig: { temperature: 0.4, maxOutputTokens: 900 },
    });
  const answer = extractGeminiText(payload);
  if (!answer) throw new Error("provider_invalid_response");
  return answer;
}

async function callCloudflare(messages: ChatMessage[]): Promise<string> {
  const accountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID")?.trim();
  const key = Deno.env.get("CLOUDFLARE_API_TOKEN")?.trim();
  if (!accountId || !key) throw new Error("provider_not_configured");
  const model = Deno.env.get("CLOUDFLARE_MODEL")?.trim() || "@cf/zai-org/glm-4.7-flash";
  const modelPath = model.split("/").map((part) => encodeURIComponent(part)).join("/");
  const payload = await fetchJson("cloudflare",
    "https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(accountId) + "/ai/run/" + modelPath,
    { Authorization: "Bearer " + key },
    { messages, max_completion_tokens: 900, temperature: 0.4 });
  if (isRecord(payload) && isRecord(payload.result) &&
      typeof payload.result.response === "string" && payload.result.response.trim()) {
    return payload.result.response.trim();
  }
  const answer = extractOpenAiText(payload);
  if (!answer) throw new Error("provider_invalid_response");
  return answer;
}

async function callOpenRouter(messages: ChatMessage[]): Promise<string> {
  const key = Deno.env.get("OPENROUTER_API_KEY")?.trim();
  if (!key) throw new Error("provider_not_configured");
  const payload = await fetchJson("openrouter", "https://openrouter.ai/api/v1/chat/completions", {
    Authorization: "Bearer " + key,
    "HTTP-Referer": "https://arownd.com",
    "X-Title": "Arownd Aide",
  }, {
    model: Deno.env.get("OPENROUTER_MODEL")?.trim() || "openrouter/free",
    messages,
    temperature: 0.4,
    max_tokens: 900,
  });
  const answer = extractOpenAiText(payload);
  if (!answer) throw new Error("provider_invalid_response");
  return answer;
}

const PROVIDERS: Array<{ name: Provider; call: (messages: ChatMessage[]) => Promise<string> }> = [
  { name: "groq", call: callGroq },
  { name: "gemini", call: callGemini },
  { name: "cloudflare", call: callCloudflare },
  { name: "openrouter", call: callOpenRouter },
];

function isProviderConfigured(provider: Provider): boolean {
  if (provider === "groq") return Boolean(Deno.env.get("GROQ_API_KEY")?.trim());
  if (provider === "gemini") return Boolean(Deno.env.get("GEMINI_API_KEY")?.trim());
  if (provider === "cloudflare") {
    return Boolean(Deno.env.get("CLOUDFLARE_ACCOUNT_ID")?.trim() && Deno.env.get("CLOUDFLARE_API_TOKEN")?.trim());
  }
  return Boolean(Deno.env.get("OPENROUTER_API_KEY")?.trim());
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!req.headers.get("Authorization")?.startsWith("Bearer ")) {
    return jsonResponse({ error: "UNAUTHORIZED" }, 401);
  }

  try {
    const payload: unknown = await req.json();
    if (!isRecord(payload) || (payload.language !== "ar" && payload.language !== "en") ||
        !Array.isArray(payload.messages) || payload.messages.length === 0 || payload.messages.length > 12) {
      return jsonResponse({ error: "INVALID_REQUEST" }, 400);
    }

    const messages: ChatMessage[] = [];
    let totalCharacters = 0;
    for (const item of payload.messages) {
      if (!isRecord(item) || (item.role !== "user" && item.role !== "assistant") ||
          typeof item.content !== "string" || !item.content.trim() || item.content.length > 4000) {
        return jsonResponse({ error: "INVALID_MESSAGES" }, 400);
      }
      totalCharacters += item.content.length;
      if (totalCharacters > 14_000) return jsonResponse({ error: "CONVERSATION_TOO_LONG" }, 413);
      messages.push({ role: item.role, content: item.content.trim() });
    }

    const system = SYSTEM_PROMPT[payload.language];
    const providerMessages: ChatMessage[] = [
      { role: "system", content: system },
      ...messages,
    ];

    const configured = PROVIDERS.filter((provider) => isProviderConfigured(provider.name));
    if (configured.length === 0) return jsonResponse({ error: "AI_NOT_CONFIGURED" }, 503);

    const failures: string[] = [];
    for (const provider of configured) {
      const cooldownUntil = providerCooldowns.get(provider.name) ?? 0;
      if (cooldownUntil > Date.now()) {
        failures.push(provider.name + ":cooldown");
        continue;
      }
      try {
        const answer = await provider.call(providerMessages);
        providerCooldowns.delete(provider.name);
        return jsonResponse({ answer });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown";
        failures.push(provider.name + ":" + reason);
        console.warn("[arownd-aide] Provider failed", provider.name, reason);
        if (!providerCooldowns.has(provider.name)) {
          providerCooldowns.set(provider.name, Date.now() + 15_000);
        }
      }
    }

    console.error("[arownd-aide] All configured providers failed", failures.join(","));
    return jsonResponse({ error: "AI_TEMPORARILY_UNAVAILABLE" }, 503);
  } catch {
    return jsonResponse({ error: "INVALID_REQUEST" }, 400);
  }
});
