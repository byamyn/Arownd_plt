import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppHeader, Button, Card, ErrorState, LoadingState, PressableSurface, Text as UiText } from "@/components/ui";
import { fetchMerchantAccess } from "@/lib/merchant";
import {
  fetchMyStoreVerificationOverview,
  getStoreVerificationRequirements,
  submitMyStoreVerificationRequest
} from "@/lib/store-verification";
import { translate, useLanguage } from "@/lib/i18n";
import { designTokens, useAppTheme, type AppTheme } from "@/lib/theme";

export default function MerchantVerificationScreen() {
  useLanguage();
  const theme = useAppTheme();
  const styles = createStyles(theme);
  const queryClient = useQueryClient();
  const access = useQuery({
    queryKey: ["merchant-access"],
    queryFn: fetchMerchantAccess,
    retry: false
  });
  const storeId = access.data?.store?.id ?? null;
  const overview = useQuery({
    queryKey: ["my-store-verification", storeId],
    queryFn: () => fetchMyStoreVerificationOverview(storeId ?? ""),
    enabled: Boolean(storeId),
    retry: false
  });
  const submit = useMutation({
    mutationFn: submitMyStoreVerificationRequest,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["my-store-verification", storeId] }),
        queryClient.invalidateQueries({ queryKey: ["merchant-dashboard", storeId] })
      ]);
    }
  });

  if (access.isPending) return <ScreenMessage theme={theme} label={translate("merchantLoading")} loading />;
  if (access.isError) return <ScreenMessage theme={theme} label={translate("merchantLoadError")} retryLabel={translate("merchantRetry")} onRetry={() => void access.refetch()} />;
  if (!access.data) return <Redirect href="/login" />;
  if (access.data.status !== "merchant_ready" || !storeId) return <Redirect href="/merchant" />;
  if (overview.isPending) return <ScreenMessage theme={theme} label={translate("verificationLoading")} loading />;
  if (overview.isError || !overview.data) return <ScreenMessage theme={theme} label={translate("verificationLoadError")} retryLabel={translate("merchantRetry")} onRetry={() => void overview.refetch()} />;

  const { store, emailConfirmed, latestRequest } = overview.data;
  const requirements = getStoreVerificationRequirements(store, emailConfirmed);
  const complete = Object.values(requirements).every(Boolean);
  const pending = latestRequest?.status === "pending";
  const approved = latestRequest?.status === "approved" && store.is_verified;
  const rejected = latestRequest?.status === "rejected";

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <AppHeader title={translate("verificationMerchantTitle")} />
        <UiText style={[styles.subtitle, { color: theme.colors.muted }]}>
          {translate("verificationMerchantSubtitle")}
        </UiText>

        <Card contentStyle={styles.statusCard}>
          <UiText style={[styles.statusTitle, { color: theme.colors.foreground }]}>
            {approved
              ? translate("verificationStatusApproved")
              : pending
                ? translate("verificationStatusPending")
                : rejected
                  ? translate("verificationStatusRejected")
                  : latestRequest?.status === "draft"
                    ? translate("verificationStatusNeedsUpdate")
                    : translate("verificationStatusNotSubmitted")}
          </UiText>
          <UiText style={[styles.statusHint, { color: theme.colors.muted }]}>
            {approved
              ? translate("verificationStatusApprovedHint")
              : pending
                ? translate("verificationStatusPendingHint")
                : rejected
                  ? translate("verificationStatusRejectedHint")
                  : translate("verificationStatusNotSubmittedHint")}
          </UiText>
          {rejected && latestRequest?.review_note ? (
            <View style={[styles.reviewNote, { backgroundColor: theme.colors.surfaceSecondary }]}>
              <UiText style={[styles.reviewNoteTitle, { color: theme.colors.foreground }]}>{translate("verificationReviewerNote")}</UiText>
              <UiText style={[styles.statusHint, { color: theme.colors.muted }]}>{latestRequest.review_note}</UiText>
            </View>
          ) : null}
        </Card>

        <Card contentStyle={styles.requirementsCard}>
          <UiText style={[styles.sectionTitle, { color: theme.colors.foreground }]}>
            {translate("verificationRequirementsTitle")}
          </UiText>
          <Requirement label={translate("verificationRequirementName")} complete={requirements.storeName} theme={theme} />
          <Requirement label={translate("verificationRequirementLogo")} complete={requirements.logo} theme={theme} />
          <Requirement label={translate("verificationRequirementPhone")} complete={requirements.phone} theme={theme} />
          <Requirement label={translate("verificationRequirementRegion")} complete={requirements.region} theme={theme} />
          <Requirement label={translate("verificationRequirementCommune")} complete={requirements.commune} theme={theme} />
          <Requirement label={translate("verificationRequirementAddress")} complete={requirements.address} theme={theme} />
          <Requirement label={translate("verificationRequirementHours")} complete={requirements.openingHours} theme={theme} />
          <Requirement label={translate("verificationRequirementEmail")} complete={requirements.emailConfirmed} theme={theme} />
          <PressableSurface
            accessibilityRole="button"
            onPress={() => router.push("/merchant/settings")}
            style={[styles.settingsLink, { borderColor: theme.colors.border }]}
          >
            <UiText style={[styles.settingsLinkText, { color: theme.colors.accent }]}>
              {translate("verificationEditStoreDetails")}
            </UiText>
          </PressableSurface>
        </Card>

        {submit.isError ? (
          <UiText style={[styles.error, { color: theme.colors.danger }]}>
            {translate("verificationSubmitError")}
          </UiText>
        ) : null}
        <Button
          label={submit.isPending ? translate("verificationSubmitting") : translate("verificationSubmit")}
          onPress={() => submit.mutate()}
          disabled={!complete || pending || approved || submit.isPending}
          fullWidth
        />
        {!emailConfirmed ? (
          <UiText style={[styles.statusHint, { color: theme.colors.muted }]}>
            {translate("verificationEmailConfirmationHint")}
          </UiText>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Requirement({ label, complete, theme }: { label: string; complete: boolean; theme: AppTheme }) {
  return (
    <View style={requirementStyles.row}>
      <View style={[requirementStyles.indicator, { backgroundColor: complete ? theme.colors.successSurface : theme.colors.surfaceSecondary }]}>
        <UiText style={{ color: complete ? theme.colors.successText : theme.colors.muted, fontWeight: "800" }}>
          {complete ? "✓" : "–"}
        </UiText>
      </View>
      <UiText style={[requirementStyles.label, { color: theme.colors.foreground }]}>{label}</UiText>
    </View>
  );
}

function ScreenMessage({ theme, label, loading, retryLabel, onRetry }: {
  theme: AppTheme;
  label: string;
  loading?: boolean;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <SafeAreaView style={[messageStyles.safe, { backgroundColor: theme.colors.background }]}>
      <View style={messageStyles.content}>
        <AppHeader title={translate("verificationMerchantTitle")} />
        {loading ? <LoadingState label={label} /> : retryLabel && onRetry ? (
          <ErrorState title={label} retryLabel={retryLabel} onRetry={onRetry} />
        ) : <UiText style={{ color: theme.colors.foreground }}>{label}</UiText>}
        <Button label={translate("merchantBackToProfile")} onPress={() => router.replace("/merchant")} variant="ghost" />
      </View>
    </SafeAreaView>
  );
}

const requirementStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  indicator: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  label: { flex: 1, fontSize: designTokens.typography.body - 1, textAlign: "auto" }
});

const messageStyles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flex: 1, padding: designTokens.spacing.lg, gap: designTokens.spacing.md }
});

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    safe: { flex: 1 },
    content: { padding: designTokens.spacing.lg, paddingBottom: designTokens.spacing.xl, gap: designTokens.spacing.md },
    subtitle: { fontSize: designTokens.typography.caption + 1, lineHeight: 20, textAlign: "auto" },
    statusCard: { gap: designTokens.spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border },
    statusTitle: { fontSize: designTokens.typography.body + 1, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
    statusHint: { fontSize: designTokens.typography.caption + 1, lineHeight: 20, textAlign: "auto" },
    reviewNote: { padding: designTokens.spacing.md, borderRadius: designTokens.radius.sm, gap: 4 },
    reviewNoteTitle: { fontSize: designTokens.typography.caption, fontWeight: designTokens.fontWeights.bold, textAlign: "auto" },
    requirementsCard: { gap: designTokens.spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border },
    sectionTitle: { fontSize: designTokens.typography.body, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
    settingsLink: { borderWidth: StyleSheet.hairlineWidth, borderRadius: designTokens.radius.sm, padding: designTokens.spacing.md, alignItems: "center" },
    settingsLinkText: { fontSize: designTokens.typography.caption + 1, fontWeight: designTokens.fontWeights.bold },
    error: { fontSize: designTokens.typography.caption, textAlign: "auto" }
  });
}
