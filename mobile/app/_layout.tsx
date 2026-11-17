import { LocaleProvider, Stack, router, usePathname } from "expo-router";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";
import { useEffect, useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import Logo from "@/components/logo";
import { AuthCaptchaHost } from "@/components/auth-captcha-host";
import { CartFlyOverlay } from "@/components/cart-fly-overlay";
import { ThemeProvider, useAppTheme, useThemePreference } from "@/lib/design-system";
import { getSupabaseClient } from "@/lib/supabase";
import { listenForPushTokenChanges, registerDeviceForPushNotifications } from "@/lib/push-notifications";
import { markNotificationRead } from "@/lib/notifications";
import { getPushNotificationDestination } from "@/lib/notifications-state";
import { LanguageProvider, useLanguage } from "@/lib/i18n";

const SPLASH_DURATION_MS = 2500;

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  return (
    <LanguageProvider>
      <ThemeProvider>
        <RootLayoutContent />
      </ThemeProvider>
    </LanguageProvider>
  );
}

function RootLayoutContent() {
  const [fontsLoaded, fontError] = useFonts([
    {
      fontFamily: "Inter",
      fontDefinitions: [
        { path: Inter_400Regular, weight: 400 },
        { path: Inter_500Medium, weight: 500 },
        { path: Inter_600SemiBold, weight: 600 },
        { path: Inter_700Bold, weight: 700 },
        { path: Inter_800ExtraBold, weight: 800 }
      ]
    }
  ]);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (failureCount, error) => {
              const status = typeof error === "object" && error !== null && "status" in error
                ? error.status
                : undefined;
              if (status === 429) return false;
              return failureCount < 1;
            },
            refetchOnWindowFocus: false
          }
        }
      })
  );
  const [showSplash, setShowSplash] = useState(true);
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { language, isReady: languageReady } = useLanguage();
  const pathname = usePathname();
  const screenScale = useRef(new Animated.Value(1)).current;
  const splashDotOne = useRef(new Animated.Value(1)).current;
  const splashDotTwo = useRef(new Animated.Value(1)).current;
  const splashDotThree = useRef(new Animated.Value(1)).current;
  const previousPathname = useRef(pathname);
  const { isReady: themeReady } = useThemePreference();
  const appReady = (fontsLoaded || Boolean(fontError)) && themeReady && languageReady;

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    const previousPath = previousPathname.current;
    previousPathname.current = pathname;
    // Product details owns its native bottom-sheet transition; do not animate its stack container.
    if (previousPath.startsWith("/product/") || pathname.startsWith("/product/")) return;

    screenScale.stopAnimation();
    screenScale.setValue(0.98);
    const animation = Animated.timing(screenScale, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    });
    animation.start();
    return () => animation.stop();
  }, [pathname, screenScale]);

  useEffect(() => {
    const createPulse = (value: Animated.Value) => Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 0.2, duration: 260, useNativeDriver: true }),
        Animated.timing(value, { toValue: 1, duration: 260, useNativeDriver: true })
      ])
    );
    const pulses = Animated.stagger(150, [
      createPulse(splashDotOne),
      createPulse(splashDotTwo),
      createPulse(splashDotThree)
    ]);
    pulses.start();
    return () => pulses.stop();
  }, [splashDotOne, splashDotTwo, splashDotThree]);

  useEffect(() => {
    if (!appReady) return;

    void SplashScreen.hideAsync().catch(() => undefined);
    const timeout = setTimeout(() => setShowSplash(false), SPLASH_DURATION_MS);

    return () => clearTimeout(timeout);
  }, [appReady]);


  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let pushTokenSubscription: Notifications.EventSubscription | null = null;
    try {
      const { data } = getSupabaseClient().auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
          queryClient.clear();
        }

        if ((event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session?.user) {
          queueMicrotask(() => {
            if (Platform.OS === "android" && !pushTokenSubscription) {
              pushTokenSubscription = listenForPushTokenChanges();
            }
            void registerDeviceForPushNotifications(language).catch(() => {
              console.warn("[push-notifications] Device registration failed.");
            });
          });
        }

        if (event === "SIGNED_OUT") {
          pushTokenSubscription?.remove();
          pushTokenSubscription = null;
        }
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "SUPABASE_CONFIG_MISSING") {
        throw error;
      }
    }

    return () => {
      unsubscribe?.();
      pushTokenSubscription?.remove();
    };
  }, [queryClient, language]);

  useEffect(() => {
    let lastHandledResponseId: string | null = null;
    const openNotificationDestination = (response: Notifications.NotificationResponse) => {
      const responseId = response.notification.request.identifier;
      if (lastHandledResponseId === responseId) return;
      lastHandledResponseId = responseId;
      const data = response.notification.request.content.data ?? {};
      if (typeof data.notification_id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.notification_id)) {
        void markNotificationRead(data.notification_id).catch(() => {
          console.warn("[push-notifications] Could not mark the notification as read.");
        });
      }
      const destination = getPushNotificationDestination(data);
      if (destination) router.push(destination as never);
    };

    const subscription = Notifications.addNotificationResponseReceivedListener(openNotificationDestination);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) openNotificationDestination(response);
    }).catch(() => {
      console.warn("[push-notifications] Could not read the launch notification.");
    });

    return () => subscription.remove();
  }, []);

  if (!appReady) return null;

  return (
    <View style={styles.root}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style={theme.mode === "dark" ? "light" : "dark"} />
        <LocaleProvider direction={language === "ar" ? "rtl" : "ltr"}>
          <Animated.View style={[styles.navigation, { transform: [{ scale: screenScale }] }]}>
            <Stack
              screenOptions={{
                headerShown: false,
                animation: "fade",
                animationDuration: 280,
                animationMatchesGesture: true,
                contentStyle: { backgroundColor: theme.colors.background }
              }}
            />
          </Animated.View>
        </LocaleProvider>
        <AuthCaptchaHost />
      </QueryClientProvider>

      <CartFlyOverlay />

      {showSplash ? (
        <View
          pointerEvents="auto"
          style={[StyleSheet.absoluteFill, styles.splash, { backgroundColor: theme.colors.background }]}
        >
          <View style={styles.logo}>
            <Logo color={theme.colors.foreground} width={220} />
          </View>
          <View style={[styles.splashFooter, { bottom: Math.max(insets.bottom, 12) + 12 }]}>
            <Text style={[styles.splashCaption, { color: theme.colors.foreground }]}>
              he's coming
              <Animated.Text style={{ opacity: splashDotOne }}>.</Animated.Text>
              <Animated.Text style={{ opacity: splashDotTwo }}>.</Animated.Text>
              <Animated.Text style={{ opacity: splashDotThree }}>.</Animated.Text>
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  navigation: {
    flex: 1
  },
  root: {
    flex: 1
  },
  splash: {
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    elevation: 10
  },
  logo: {
    position: "absolute",
    top: "50%",
    alignItems: "center",
    justifyContent: "center",
    transform: [{ translateY: -20 }]
  },
  splashFooter: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center"
  },
  splashCaption: {
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 1.1,
    fontWeight: "500"
  }
});
