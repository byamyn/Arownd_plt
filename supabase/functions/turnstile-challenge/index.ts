import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const RETURN_URL = "com.arownd.app://captcha";

function htmlResponse(body: string, status = 200): Response {
  const headers = new Headers({
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; script-src https://challenges.cloudflare.com 'unsafe-inline'; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  });
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(
    new Blob([body], { type: "text/html;charset=utf-8" }),
    { status, headers }
  );
}

function messagePage(title: string, message: string): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${title}</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f7f5;color:#171717;font-family:Arial,sans-serif;padding:24px;box-sizing:border-box}
    main{width:min(100%,420px);padding:28px;border:1px solid #e5e5e5;border-radius:18px;background:#fff;text-align:center;box-sizing:border-box}
    h1{font-size:20px;margin:0 0 12px}p{font-size:15px;line-height:1.7;color:#555;margin:0}
  </style>
</head>
<body><main><h1>${title}</h1><p>${message}</p></main></body>
</html>`;
}

Deno.serve((request: Request) => {
  if (request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { "Allow": "GET", "Cache-Control": "no-store" }
    });
  }

  const requestUrl = new URL(request.url);
  const returnUrl = requestUrl.searchParams.get("return_url");
  if (returnUrl !== RETURN_URL) {
    return htmlResponse(messagePage(
      "طلب غير صالح",
      "تعذر بدء عملية التحقق. ارجع إلى التطبيق وحاول مرة أخرى."
    ), 400);
  }

  const siteKey = Deno.env.get("TURNSTILE_SITE_KEY")?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(siteKey)) {
    return htmlResponse(messagePage(
      "التحقق غير مهيأ",
      "لم يكتمل إعداد التحقق الآمن لهذا التطبيق بعد."
    ), 503);
  }

  const page = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>التحقق الأمني - Arownd</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f7f5;color:#171717;font-family:Arial,sans-serif;padding:24px;box-sizing:border-box}
    main{width:min(100%,440px);padding:28px;border:1px solid #e5e5e5;border-radius:18px;background:#fff;text-align:center;box-sizing:border-box}
    h1{font-size:21px;margin:0 0 10px}p{font-size:15px;line-height:1.7;color:#555;margin:0 0 22px}
    #turnstile-widget{display:flex;justify-content:center;min-height:66px}
    #status{margin-top:16px;min-height:24px;font-size:14px;color:#666}
  </style>
  <script>
    function onTurnstileLoaded() {
      if (!window.turnstile) {
        document.getElementById("status").textContent = "تعذر تحميل التحقق. أعد المحاولة.";
        return;
      }
      window.turnstile.render("#turnstile-widget", {
        sitekey: "${siteKey}",
        callback: function(token) {
          window.location.replace("${RETURN_URL}?token=" + encodeURIComponent(token));
        },
        "expired-callback": function() {
          document.getElementById("status").textContent = "انتهت صلاحية التحقق. أعد المحاولة.";
        },
        "error-callback": function() {
          document.getElementById("status").textContent = "تعذر إكمال التحقق. تحقق من اتصال الإنترنت.";
        },
        theme: "light"
      });
    }
  </script>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoaded&render=explicit" async defer></script>
</head>
<body>
  <main>
    <h1>تحقق من أنك مستخدم حقيقي</h1>
    <p>أكمل خطوة التحقق للعودة إلى تطبيق Arownd ومتابعة العملية.</p>
    <div id="turnstile-widget"></div>
    <div id="status" role="status" aria-live="polite"></div>
  </main>
</body>
</html>`;
  return htmlResponse(page);
});
