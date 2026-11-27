import { useQuery } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppHeader, Icon, PressableSurface, RefreshableScrollView, Text as UiText } from "@/components/ui";
import { fetchMerchantAccess } from "@/lib/merchant";
import { translate, useLanguage } from "@/lib/i18n";
import { designTokens, useAppTheme } from "@/lib/theme";

export default function MerchantAccountSettingsScreen() {
  useLanguage();
  const theme = useAppTheme();
  const access = useQuery({
    queryKey: ["merchant-access"],
    queryFn: ({ signal }) => fetchMerchantAccess(signal),
    retry: false
  });

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
    <SafeAreaView edges={["top", "left", "right"]} style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <RefreshableScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshing={access.isFetching} onRefresh={() => { void access.refetch(); }}>
        <AppHeader
          title={translate("merchantAccountSettingsTitle")}
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
  );
}

const styles = StyleSheet.create({
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
  }
});
