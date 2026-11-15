import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
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

type PendingCaptcha = {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export function AuthCaptchaHost() {
  const theme = useAppTheme();
  useLanguage();

  const pendingRef = useRef<PendingCaptcha | null>(null);
  const [visible, setVisible] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const finish = useCallback((error?: Error, token?: string) => {
    const pending = pendingRef.current;
    if (!pending) return;

    clearTimeout(pending.timeout);
    pendingRef.current = null;
    setVisible(false);
    setHtml(null);
    setLoading(false);
    setLoadError(false);

    if (error) pending.reject(error);
    else if (token) pending.resolve(token);
    else pending.reject(new Error("AUTH_CAPTCHA_TOKEN_MISSING"));
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

      if (!response.ok || !page.toLowerCase().includes("<html")) {
        throw new Error("AUTH_CAPTCHA_LOAD_FAILED");
      }

      setHtml(page);
    } catch {
      setLoading(false);
      setLoadError(true);
    }
  }, []);

  const startCaptcha = useCallback(() => new Promise<string>((resolve, reject) => {
    if (pendingRef.current) {
      reject(new Error("AUTH_CAPTCHA_ALREADY_OPEN"));
      return;
    }

    const timeout = setTimeout(() => {
      finish(new Error("AUTH_CAPTCHA_TIMEOUT"));
    }, CAPTCHA_TIMEOUT_MS);

    pendingRef.current = { resolve, reject, timeout };
    setVisible(true);
    void loadChallenge();
  }), [finish, loadChallenge]);

  const handleNavigation = useCallback((navigation: WebViewNavigation) => {
    if (navigation.url.startsWith(RETURN_URL)) {
      try {
        const callbackUrl = new URL(navigation.url);
        const token = callbackUrl.searchParams.get("token");
        if (token) finish(undefined, token);
        else finish(new Error("AUTH_CAPTCHA_TOKEN_MISSING"));
      } catch {
        finish(new Error("AUTH_CAPTCHA_CALLBACK_INVALID"));
      }
      return false;
    }

    if (navigation.url === "about:blank") return true;

    try {
      const url = new URL(navigation.url);
      return url.protocol === "https:" && (
        url.hostname === "challenges.cloudflare.com" ||
        url.hostname.endsWith(".cloudflare.com")
      );
    } catch {
      return false;
    }
  }, [finish]);

  useEffect(() => registerAuthCaptchaHandler(startCaptcha), [startCaptcha]);

  const close = () => finish(new Error("AUTH_CAPTCHA_CANCELLED"));

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={close}
      statusBarTranslucent
    >
      <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: theme.colors.foreground }]}>
              {translate("captchaTitle")}
            </Text>
            <Text style={[styles.subtitle, { color: theme.colors.foreground }]}>
              {translate("captchaSubtitle")}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={translate("captchaCancel")}
            onPress={close}
            hitSlop={12}
            style={styles.closeButton}
          >
            <Text style={[styles.closeText, { color: theme.colors.foreground }]}>×</Text>
          </Pressable>
        </View>

        <View style={styles.content}>
          {html ? (
            <WebView
              source={{ html, baseUrl: CHALLENGE_URL }}
              javaScriptEnabled
              domStorageEnabled
              thirdPartyCookiesEnabled
              originWhitelist={["http://*", "https://*", "about:blank"]}
              onShouldStartLoadWithRequest={handleNavigation}
              onError={() => {
                setLoading(false);
                setLoadError(true);
              }}
              onHttpError={(event) => {
                if (event.nativeEvent.status >= 400) {
                  setLoading(false);
                  setLoadError(true);
                }
              }}
              onLoadEnd={() => setLoading(false)}
              style={styles.webView}
            />
          ) : null}

          {loading ? (
            <View style={styles.stateOverlay}>
              <ActivityIndicator size="large" color="#D6C400" />
              <Text style={[styles.stateText, { color: theme.colors.foreground }]}>
                {translate("captchaLoading")}
              </Text>
            </View>
          ) : null}

          {loadError ? (
            <View style={styles.stateOverlay}>
              <Text style={[styles.stateText, { color: theme.colors.foreground }]}>
                {translate("captchaLoadError")}
              </Text>
              <Pressable onPress={() => void loadChallenge()} style={styles.retryButton}>
                <Text style={styles.retryText}>{translate("retry")}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 24 },
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
  content: { flex: 1, margin: 16, borderRadius: 18, overflow: "hidden" },
  webView: { flex: 1, backgroundColor: "transparent" },
  stateOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 24,
    backgroundColor: "#FFFFFF"
  },
  stateText: { fontSize: 15, lineHeight: 23, textAlign: "center" },
  retryButton: {
    minHeight: 44,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FDE72A"
  },
  retryText: { color: "#171717", fontSize: 14, fontWeight: "700" }
});
