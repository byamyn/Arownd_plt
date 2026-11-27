import { useQuery } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Dimensions,
  I18nManager,
  PanResponder,
  Pressable,
  StyleSheet,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppHeader, Icon, IconButton, PressableSurface, RefreshableScrollView, Text as UiText } from "@/components/ui";
import { fetchMerchantAccess } from "@/lib/merchant";
import { translate, useLanguage } from "@/lib/i18n";
import { designTokens, useAppTheme } from "@/lib/theme";

const EDGE_WIDTH = 26;

export default function MerchantAccountSettingsScreen() {
  useLanguage();
  const theme = useAppTheme();
  const access = useQuery({
    queryKey: ["merchant-access"],
    queryFn: ({ signal }) => fetchMerchantAccess(signal),
    retry: false
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerOpenRef = useRef(false);
  const drawerWidth = Math.min(Dimensions.get("window").width * 0.84, 340);
  const drawerX = useRef(new Animated.Value(drawerWidth)).current;

  const openDrawer = useCallback(() => {
    drawerOpenRef.current = true;
    setDrawerOpen(true);
    Animated.spring(drawerX, {
      toValue: 0,
      useNativeDriver: true,
      damping: 24,
      stiffness: 220,
      mass: 0.8
    }).start();
  }, [drawerX]);

  const closeDrawer = useCallback(() => {
    drawerOpenRef.current = false;
    Animated.spring(drawerX, {
      toValue: drawerWidth,
      useNativeDriver: true,
      damping: 24,
      stiffness: 220,
      mass: 0.8
    }).start(({ finished }) => {
      if (finished) setDrawerOpen(false);
    });
  }, [drawerWidth, drawerX]);

  useEffect(() => {
    if (!drawerOpen) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      closeDrawer();
      return true;
    });
    return () => subscription.remove();
  }, [closeDrawer, drawerOpen]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponderCapture: (_event, gesture) => {
      if (Math.abs(gesture.dx) < 8 || Math.abs(gesture.dx) < Math.abs(gesture.dy) * 1.2) return false;
      const fromRightEdge = gesture.x0 >= Dimensions.get("window").width - EDGE_WIDTH;
      const fromLeftEdge = gesture.x0 <= EDGE_WIDTH;
      if (drawerOpenRef.current) {
        const insideDrawer = I18nManager.isRTL
          ? gesture.x0 >= Dimensions.get("window").width - drawerWidth
          : gesture.x0 <= drawerWidth;
        return insideDrawer && (I18nManager.isRTL ? gesture.dx > 0 : gesture.dx < 0);
      }
      return I18nManager.isRTL
        ? fromRightEdge && gesture.dx < 0
        : fromLeftEdge && gesture.dx > 0;
    },
    onPanResponderGrant: () => undefined,
    onPanResponderMove: (_event, gesture) => {
      const delta = I18nManager.isRTL ? gesture.dx : -gesture.dx;
      const next = drawerOpenRef.current
        ? Math.max(0, Math.min(drawerWidth, delta))
        : Math.max(0, Math.min(drawerWidth, drawerWidth - Math.max(0, -delta)));
      drawerX.setValue(next);
    },
    onPanResponderRelease: (_event, gesture) => {
      const delta = I18nManager.isRTL ? gesture.dx : -gesture.dx;
      if (drawerOpenRef.current) {
        if (delta > drawerWidth * 0.24 || (I18nManager.isRTL ? gesture.vx : -gesture.vx) > 0.55) closeDrawer();
        else openDrawer();
      } else {
        if (-delta > drawerWidth * 0.24 || (I18nManager.isRTL ? -gesture.vx : gesture.vx) > 0.55) openDrawer();
        else closeDrawer();
      }
    },
    onPanResponderTerminate: () => {
      if (drawerOpenRef.current) openDrawer();
      else closeDrawer();
    },
    onPanResponderTerminationRequest: () => false
  }), [closeDrawer, drawerWidth, drawerX, openDrawer]);

  if (access.isPending) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
        <View style={styles.center}>
          <UiText>{translate("merchantLoading")}</UiText>
        </View>
      </SafeAreaView>
    );
  }

  if (access.isError) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
        <View style={styles.center}>
          <UiText>{translate("merchantLoadError")}</UiText>
          <PressableSurface onPress={() => void access.refetch()} style={styles.retry}>
            <UiText style={{ color: theme.colors.accentMuted }}>{translate("merchantRetry")}</UiText>
          </PressableSurface>
        </View>
      </SafeAreaView>
    );
  }

  if (!access.data) return <Redirect href="/login" />;
  if (access.data.status !== "merchant_ready" || !access.data.store?.id) return <Redirect href="/merchant" />;

  const isOwner = access.data.teamRole === "owner";
  const sections = [
    {
      key: "store",
      title: translate("merchantStudioSettingsStoreSection"),
      links: [
        {
          key: "switch-store",
          icon: "store" as const,
          title: translate("merchantSelectStoreTitle"),
          description: translate("merchantSelectStoreSubtitle"),
          onPress: () => router.push("/merchant/select-store")
        },
        ...(isOwner ? [
          {
            key: "store-details",
            icon: "store" as const,
            title: translate("merchantAccountSettingsStore"),
            description: translate("merchantAccountSettingsStoreHint"),
            onPress: () => router.push("/merchant/settings")
          },
          {
            key: "verification",
            icon: "circle-check" as const,
            title: translate("merchantAccountSettingsVerification"),
            description: translate("merchantAccountSettingsVerificationHint"),
            onPress: () => router.push("/merchant/verification")
          }
        ] : [])
      ]
    },
    ...(isOwner ? [{
      key: "team",
      title: translate("merchantStudioSettingsTeamSection"),
      links: [{
        key: "team",
        icon: "users" as const,
        title: translate("merchantTeamManage"),
        description: translate("merchantTeamSubtitle"),
        onPress: () => router.push("/merchant/team")
      }]
    }] : [])
  ];

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]} {...panResponder.panHandlers}>
      <SafeAreaView edges={["top", "left", "right"]} style={[styles.safe, { backgroundColor: theme.colors.background }]}>
        <RefreshableScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshing={access.isFetching} onRefresh={() => { void access.refetch(); }}>
          <AppHeader
            title={translate("merchantAccountSettingsTitle")}
            trailing={
              <IconButton
                accessibilityLabel={translate("merchantAccountSettingsTitle")}
                onPress={openDrawer}
                variant="ghost"
                icon={<Icon name="menu" size={22} color={theme.colors.foreground} />}
              />
            }
          />
          {sections.map((section) => (
            <View key={section.key} style={styles.section}>
              <UiText weight="700" style={[styles.sectionTitle, { color: theme.colors.muted }]}>
                {section.title}
              </UiText>
              <View style={styles.linksList}>
                {section.links.map((item, index) => (
                  <PressableSurface
                    key={item.key}
                    accessibilityRole="button"
                    accessibilityLabel={item.title}
                    onPress={item.onPress}
                    style={[
                      styles.link,
                      index < section.links.length - 1 && { borderBottomColor: theme.colors.divider, borderBottomWidth: StyleSheet.hairlineWidth }
                    ]}
                  >
                    <View style={[styles.icon, { backgroundColor: theme.colors.surfaceSecondary }]}>
                      <Icon name={item.icon} size={20} color={theme.colors.accentOnSurface} accessibilityHidden />
                    </View>
                    <View style={styles.copy}>
                      <UiText weight="700">{item.title}</UiText>
                      <UiText style={{ color: theme.colors.muted, fontSize: designTokens.typography.caption }}>
                        {item.description}
                      </UiText>
                    </View>
                    <Icon name="chevron-left" size={18} color={theme.colors.subtle} accessibilityHidden />
                  </PressableSurface>
                ))}
              </View>
            </View>
          ))}
        </RefreshableScrollView>
      </SafeAreaView>

      {drawerOpen ? (
        <View style={styles.drawerLayer} pointerEvents="box-none">
          <Pressable accessibilityRole="button" accessibilityLabel={translate("back")} onPress={closeDrawer} style={styles.backdrop}>
            <Animated.View style={[styles.backdropTint, { opacity: drawerX.interpolate({ inputRange: [0, drawerWidth], outputRange: [0.42, 0] }) }]} />
          </Pressable>
          <Animated.View
            accessibilityViewIsModal
            style={[
              styles.drawer,
              {
                width: drawerWidth,
                backgroundColor: theme.colors.surface,
                borderStartColor: theme.colors.divider,
                transform: [{ translateX: I18nManager.isRTL ? drawerX : drawerX.interpolate({ inputRange: [0, drawerWidth], outputRange: [0, -drawerWidth] }) }]
              },
              I18nManager.isRTL ? { right: 0 } : { left: 0 }
            ]}
          >
            <SafeAreaView edges={["top", "bottom"]} style={styles.drawerSafe}>
              <View style={styles.drawerHeader}>
                <UiText weight="800" style={styles.drawerTitle}>{translate("merchantAccountSettingsTitle")}</UiText>
                <IconButton
                  accessibilityLabel={translate("back")}
                  onPress={closeDrawer}
                  variant="ghost"
                  icon={<Icon name="x" size={20} color={theme.colors.foreground} />}
                />
              </View>
              {sections.map((section) => (
                <View key={section.key} style={styles.drawerSection}>
                  <UiText weight="700" style={[styles.sectionTitle, { color: theme.colors.muted }]}>{section.title}</UiText>
                  {section.links.map((item) => (
                    <Pressable
                      key={item.key}
                      accessibilityRole="button"
                      accessibilityLabel={item.title}
                      onPress={() => {
                        closeDrawer();
                        item.onPress();
                      }}
                      style={({ pressed }) => [styles.drawerLink, { borderBottomColor: theme.colors.divider, opacity: pressed ? 0.7 : 1 }]}
                    >
                      <Icon name={item.icon} size={19} color={theme.colors.accentOnSurface} />
                      <UiText weight="600" style={styles.drawerLinkText}>{item.title}</UiText>
                      <Icon name={I18nManager.isRTL ? "chevron-left" : "chevron-right"} size={17} color={theme.colors.subtle} />
                    </Pressable>
                  ))}
                </View>
              ))}
            </SafeAreaView>
          </Animated.View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
  safe: { flex: 1 },
  content: {
    padding: designTokens.spacing.xl,
    paddingBottom: designTokens.spacing.xxl,
    gap: designTokens.spacing.lg
  },
  section: { gap: designTokens.spacing.xs },
  sectionTitle: {
    fontSize: designTokens.typography.caption,
    paddingTop: designTokens.spacing.sm
  },
  linksList: { gap: 0 },
  link: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    gap: designTokens.spacing.md,
    paddingVertical: designTokens.spacing.md
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: designTokens.radius.md,
    alignItems: "center",
    justifyContent: "center"
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 3
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: designTokens.spacing.xl,
    gap: designTokens.spacing.md
  },
  retry: {
    padding: designTokens.spacing.md
  },
  drawerLayer: { ...StyleSheet.absoluteFillObject, zIndex: 20 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "transparent" },
  backdropTint: { ...StyleSheet.absoluteFillObject, backgroundColor: "#000000" },
  drawer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderStartWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: designTokens.spacing.lg,
    elevation: 18,
    shadowColor: "#000000",
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: -6, height: 0 }
  },
  drawerSafe: { flex: 1, gap: designTokens.spacing.lg },
  drawerHeader: {
    minHeight: designTokens.dimensions.controlHeight.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.divider
  },
  drawerTitle: { flex: 1, fontSize: designTokens.typography.subtitle },
  drawerSection: { gap: designTokens.spacing.xs },
  drawerLink: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: designTokens.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  drawerLinkText: { flex: 1, fontSize: designTokens.typography.body }
});
