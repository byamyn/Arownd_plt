import { useQuery } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";\nimport { StyleSheet } from "react-native";

import { Button, ErrorState, MetricCardSkeleton, RefreshableScrollView, Text as UiText } from "@/components/ui";
import { fetchMerchantAccess } from "@/lib/merchant";
import { translate, useLanguage } from "@/lib/i18n";
import { designTokens, useAppTheme, type AppTheme } from "@/lib/theme";

export default function MerchantEntryScreen() {
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
        <View style={styles.loading}>
          <MetricCardSkeleton />
          <MetricCardSkeleton />
        </View>
      </SafeAreaView>
    );
  }

  if (access.isError) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
        <View style={styles.message}>
          <ErrorState
            title={translate("merchantLoadError")}
            retryLabel={translate("merchantRetry")}
            busy={access.isFetching}
            onRetry={() => void access.refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (!access.data) return <Redirect href="/login" />;

  if (access.data.status === "merchant_ready" && access.data.store?.id) {
    return <Redirect href="/merchant/orders" />;
  }

  if (access.data.status === "personal" || access.data.status === "merchant_setup_required") {
    return (
      <SafeAreaView edges={["top", "left", "right"]} style={[styles.safe, { backgroundColor: theme.colors.background }]}>
        <RefreshableScrollView contentContainerStyle={styles.entryContent} refreshing={access.isFetching} onRefresh={() => { void access.refetch(); }}>
          <Button label={translate("merchantBackToProfile")} onPress={() => router.replace("/profile")} variant="ghost" size="sm" />
          <View style={styles.entrySection}>
            <UiText style={[styles.eyebrow, { color: theme.colors.accentMuted }]}>{translate("businessTitle")}</UiText>
            <UiText style={[styles.title, { color: theme.colors.foreground }]}>
              {translate("merchantEntryTitle")}
            </UiText>
            <UiText style={[styles.body, { color: theme.colors.muted }]}>
              {access.data.status === "personal"
                ? translate("merchantStatusPersonalHint")
                : translate("merchantStatusSetupHint")}
            </UiText>
            <Button label={translate("merchantStartOnboarding")} onPress={() => router.push("/merchant/onboarding")} fullWidth />
          </View>
        </RefreshableScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <View style={styles.message}>
        <ErrorState
          title={translate("merchantStatusInconsistentHint")}
          retryLabel={translate("merchantBackToProfile")}
          onRetry={() => router.replace("/profile")}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  loading: { flex: 1, padding: designTokens.spacing.xl, justifyContent: "center", gap: designTokens.spacing.md },
  message: { flex: 1, padding: designTokens.spacing.xxl, alignItems: "center", justifyContent: "center" },
  entryContent: { flexGrow: 1, padding: designTokens.spacing.xl, gap: designTokens.spacing.xl },
  entrySection: { paddingVertical: designTokens.spacing.xl, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.divider, gap: designTokens.spacing.lg },
  eyebrow: { fontSize: designTokens.typography.caption, fontWeight: designTokens.fontWeights.extrabold },
  title: { fontSize: designTokens.typography.display - 4, lineHeight: 33, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
  body: { fontSize: designTokens.typography.caption + 1, lineHeight: 20, textAlign: "auto" }
});
