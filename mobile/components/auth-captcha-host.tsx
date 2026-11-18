import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";

import { registerAuthCaptchaHandler } from "@/lib/auth-captcha";
import { useAppTheme } from "@/lib/design-system";
import { translate, useLanguage } from "@/lib/i18n";

const CHALLENGE_URL = "https://nagzoafkitfsqlcwsdau.supabase.co/functions/v1/turnstile-challenge";
const RETURN_URL = "com.arownd.app://captcha";
const CAPTCHA_TIMEOUT_MS = 180_000;
const TOKEN_MAX_AGE_MS = 240_000;

type PendingCaptcha = {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type CaptchaMessage =
  | { type: "ready" }
  | { type: "token"; token: string }
  | { type: "interactive"; active: boolean }
  | { type: "expired" }
  | { type: "error"; code?: string };

export function AuthCaptchaHost() {
  const theme = useAppTheme();
  useLanguage();

  const webViewRef = useRef<WebView>(null);
  const pendingRef = useRef<PendingCaptcha | null>(null);
  const cachedTokenRef = useRef<{ value: string; createdAt: number } | null>(null);
  const widgetReadyRef = useRef(false);
  const tokenIssuedRef = useRef(false);
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [interactive, setInteractive] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const settlePending = useCallback((error?: Error, token?: string) => {
    const pending = pendingRef.current;
    if (!pending) return;

    clearTimeout(pending.timeout);
    pendingRef.current = null;
    if (error) pending.reject(error);
    else if (token) pending.resolve(token);
    else pending.reject(new Error("AUTH_CAPTCHA_TOKEN_MISSING"));
  }, []);

  const resetWidget = useCallback(() => {
    webViewRef.current?.injectJavaScript(
      "if (window.resetArowndTurnstile) window.resetArowndTurnstile(); true;"
    );
  }, []);

  const loadChallenge = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setHtml(null);

    try {
      const response = await fetch(
        CHALLENGE_URL + "?return_url=" + encodeURIComponent(RETURN_URL),
        { headers: { Accept: "text/html" } }
      );
      const page = await response.text();

      if (!response.ok || !page.toLowerCase().includes("<html") || !page.toLowerCase().includes("</head>")) {
        throw new Error("AUTH_CAPTCHA_LOAD_FAILED");
      }

      const contentSecurityPolicy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src https://challenges.cloudflare.com \'unsafe-inline\'; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">';
      setHtml(page.replace(/<head[^>]*>/i, (head) => head + contentSecurityPolicy));
    } catch {
      setLoading(false);
      setLoadError(true);
      settlePending(new Error("AUTH_CAPTCHA_LOAD_FAILED"));
    }
  }, [settlePending]);

  const requestCaptcha = useCallback(() => {
    const cached = cachedTokenRef.current;
    if (cached && Date.now() - cached.createdAt < TOKEN_MAX_AGE_MS) {
      cachedTokenRef.current = null;
      return Promise.resolve(cached.value);
    }
    cachedTokenRef.current = null;

    if (pendingRef.current) {
      return Promise.reject(new Error("AUTH_CAPTCHA_ALREADY_PENDING"));
    }

    if (loadError) {
      return Promise.reject(new Error("AUTH_CAPTCHA_LOAD_FAILED"));
    }

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        settlePending(new Error("AUTH_CAPTCHA_TIMEOUT"));
      }, CAPTCHA_TIMEOUT_MS);
      pendingRef.current = { resolve, reject, timeout };
      if (widgetReadyRef.current && tokenIssuedRef.current) {
        tokenIssuedRef.current = false;
        resetWidget();
      }
    });
  }, [loadError, resetWidget, settlePending]);

  const handleMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    let message: CaptchaMessage;
    try {
      message = JSON.parse(event.nativeEvent.data) as CaptchaMessage;
    } catch {
      return;
    }

    if (message.type === "ready") {
      widgetReadyRef.current = true;
      return;
    }

    if (message.type === "token" && typeof message.token === "string" && message.token.length > 0) {
      setInteractive(false);
      setLoadError(false);
      tokenIssuedRef.current = true;
      if (pendingRef.current) {
        settlePending(undefined, message.token);
      } else cachedTokenRef.current = { value: message.token, createdAt: Date.now() };
      return;
    }

    if (message.type === "interactive") {
      setInteractive(message.active);
      return;
    }

    if (message.type === "expired") {
      cachedTokenRef.current = null;
      tokenIssuedRef.current = false;
      return;
    }

    if (message.type === "error") {
      cachedTokenRef.current = null;
      setInteractive(false);
      setLoadError(true);
      settlePending(new Error("AUTH_CAPTCHA_CHALLENGE_FAILED"));
    }
  }, [resetWidget, settlePending]);

  const closeChallenge = useCallback(() => {
    setInteractive(false);
    settlePending(new Error("AUTH_CAPTCHA_CANCELLED"));
    tokenIssuedRef.current = false;
    resetWidget();
  }, [resetWidget, settlePending]);

  const handleNavigation = useCallback((navigation: WebViewNavigation) => {
    if (navigation.url === "about:blank") return true;

    try {
      const url = new URL(navigation.url);
      return url.protocol === "https:" && (
        url.hostname === "challenges.cloudflare.com" ||
        url.hostname === "nagzoafkitfsqlcwsdau.supabase.co" ||
        url.hostname.endsWith(".cloudflare.com")
      );
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    void loadChallenge();
  }, [loadChallenge]);

  useEffect(() => registerAuthCaptchaHandler(requestCaptcha), [requestCaptcha]);

  useEffect(() => {
    if (!interactive && !loadError) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      closeChallenge();
      return true;
    });
    return () => subscription.remove();
  }, [closeChallenge, interactive, loadError]);

  useEffect(() => () => {
    const pending = pendingRef.current;
    if (pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("AUTH_CAPTCHA_UNAVAILABLE"));
      pendingRef.current = null;
    }
  }, []);

  return (
    <View
      pointerEvents={interactive || loadError ? "auto" : "none"}
      style={[StyleSheet.absoluteFill, styles.host]}
    >
      {html ? (
        <WebView
          ref={webViewRef}
          source={{ html, baseUrl: CHALLENGE_URL }}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          originWhitelist={["https://*", "about:blank"]}
          onMessage={handleMessage}
          onShouldStartLoadWithRequest={handleNavigation}
          onError={() => {
            setLoading(false);
            setLoadError(true);
            settlePending(new Error("AUTH_CAPTCHA_LOAD_FAILED"));
          }}
          onHttpError={(event) => {
            if (event.nativeEvent.statusCode >= 400) {
              setLoading(false);
              setLoadError(true);
              settlePending(new Error("AUTH_CAPTCHA_LOAD_FAILED"));
            }
          }}
          onLoadEnd={() => setLoading(false)}
          style={[styles.webView, { opacity: interactive ? 1 : 0.001 }]}
        />
      ) : null}

      {interactive || loadError ? (
        <View
          pointerEvents="box-none"
          style={[styles.nativeOverlay, { backgroundColor: loadError ? theme.colors.background : "transparent" }]}
        >
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={[styles.title, { color: theme.colors.foreground }]}>
                {translate("captchaTitle")}
              </Text>
              <Text style={[styles.subtitle, { color: theme.colors.foreground }]}>
                {loadError ? translate("captchaLoadError") : translate("captchaSubtitle")}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={translate("captchaCancel")}
              onPress={closeChallenge}
              hitSlop={12}
              style={styles.closeButton}
            >
              <Text style={[styles.closeText, { color: theme.colors.foreground }]}>×</Text>
            </Pressable>
          </View>

          {loadError ? (
            <View style={styles.retryArea}>
              <Pressable
                onPress={() => void loadChallenge()}
                style={[styles.retryButton, { backgroundColor: theme.colors.accent }]}
              >
                <Text style={[styles.retryText, { color: theme.colors.accentForeground }]}>
                  {translate("retry")}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.challengeStatus}>
              <ActivityIndicator size="small" color={theme.colors.accentOnSurface} />
              <Text style={[styles.stateText, { color: theme.colors.foreground }]}>
                {translate("captchaLoading")}
              </Text>
            </View>
          )}
        </View>
      ) : null}

      {loading && !html ? <View style={styles.loadingSentinel} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    zIndex: 1000,
    elevation: 1000
  },
  webView: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent"
  },
  nativeOverlay: {
    ...StyleSheet.absoluteFillObject,
    paddingTop: 24,
    zIndex: 2
  },
  header: {
    minHeight: 76,
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16
  },
  headerText: { flex: 1, gap: 4 },
  title: { fontSize: 20, fontWeight: "700", textAlign: "right" },
  subtitle: { fontSize: 13, lineHeight: 20, textAlign: "right", opacity: 0.75 },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: "rgba(127,127,127,0.12)"
  },
  closeText: { fontSize: 30, lineHeight: 34, fontWeight: "400" },
  challengeStatus: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 36,
    alignItems: "center",
    gap: 10
  },
  stateText: { fontSize: 14, textAlign: "center" },
  retryArea: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  retryButton: {
    minHeight: 44,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  retryText: { fontSize: 14, fontWeight: "700" },
  loadingSentinel: { width: 1, height: 1, opacity: 0 }
});
