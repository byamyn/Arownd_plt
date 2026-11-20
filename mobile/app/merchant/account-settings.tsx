import { useQuery } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppHeader, Card, Icon, IconButton, PressableSurface, Text as UiText } from "@/components/ui";
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
  const links = [
    ...(isOwner ? [{
      key: "store",
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
    }] : []),
    {
      key: "account",
      icon: "settings" as const,
      title: translate("merchantAccountSettingsAccount"),
      description: translate("merchantAccountSettingsAccountHint"),
      onPress: () => router.push("/settings")
    }
  ];

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <AppHeader
          title={translate("merchantAccountSettingsTitle")}        />
        <Card contentStyle={styles.linksCard}>
          {links.map((item, index) => (
            <PressableSurface
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={item.title}
              onPress={item.onPress}
              style={[
                styles.link,
                index < links.length - 1 && { borderBottomColor: theme.colors.border, borderBottomWidth: StyleSheet.hairlineWidth }
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
        </Card>
      </ScrollView>
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
  subtitle: {
    fontSize: designTokens.typography.caption + 1,
    lineHeight: 20
  },
  linksCard: {
    paddingHorizontal: designTokens.spacing.md,
    paddingVertical: 0
  },
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
