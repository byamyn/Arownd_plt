import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppHeader, Button, Card, ErrorState, Image as UiImage, LoadingState, Text as UiText, TextField } from "@/components/ui";
import {
  fetchStoreVerificationQueue,
  fetchStoreVerificationReviewerAccess,
  reviewStoreVerificationRequest,
  type StoreVerificationQueueItem
} from "@/lib/store-verification";
import { translate, useLanguage } from "@/lib/i18n";
import { getRegionDisplayName } from "@/lib/country-regions";
import { designTokens, useAppTheme, type AppTheme } from "@/lib/theme";

export default function StoreVerificationModerationScreen() {
  const { language } = useLanguage();
  const theme = useAppTheme();
  const styles = createStyles(theme);
  const queryClient = useQueryClient();
  const [rejectionNotes, setRejectionNotes] = useState<Record<string, string>>({});
  const reviewer = useQuery({
    queryKey: ["store-verification-reviewer"],
    queryFn: fetchStoreVerificationReviewerAccess,
    retry: false
  });
  const queue = useQuery({
    queryKey: ["store-verification-queue"],
    queryFn: fetchStoreVerificationQueue,
    enabled: reviewer.data === true,
    retry: false
  });
  const review = useMutation({
    mutationFn: ({ requestId, decision, note }: {
      requestId: string;
      decision: "approved" | "rejected";
      note?: string;
    }) => reviewStoreVerificationRequest(requestId, decision, note),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["store-verification-queue"] }),
        queryClient.invalidateQueries({ queryKey: ["my-store-verification"] }),
        queryClient.invalidateQueries({ queryKey: ["merchant-dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["map-stores"] }),
        queryClient.invalidateQueries({ queryKey: ["customer-featured-stores"] }),
        queryClient.invalidateQueries({ queryKey: ["customer-stores-by-region"] }),
        queryClient.invalidateQueries({ queryKey: ["customer-store"] }),
        queryClient.invalidateQueries({ queryKey: ["customer-store-offers"] })
      ]);
    }
  });

  if (reviewer.isPending) {
    return <ScreenMessage theme={theme} loading label={translate("verificationLoading")} />;
  }
  if (reviewer.isError) {
    return <ScreenMessage theme={theme} label={translate("verificationLoadError")} retryLabel={translate("merchantRetry")} onRetry={() => void reviewer.refetch()} />;
  }
  if (!reviewer.data) {
    return <ScreenMessage theme={theme} label={translate("verificationReviewerForbidden")} />;
  }
  if (queue.isPending) {
    return <ScreenMessage theme={theme} loading label={translate("verificationQueueLoading")} />;
  }
  if (queue.isError) {
    return <ScreenMessage theme={theme} label={translate("verificationQueueError")} retryLabel={translate("merchantRetry")} onRetry={() => void queue.refetch()} />;
  }

  const decide = (item: StoreVerificationQueueItem, decision: "approved" | "rejected") => {
    const note = rejectionNotes[item.id]?.trim() ?? "";
    if (decision === "rejected" && !note) return;
    review.mutate({
      requestId: item.id,
      decision,
      ...(decision === "rejected" ? { note } : {})
    });
  };

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <AppHeader title={translate("verificationModerationTitle")} />
        <UiText style={[styles.subtitle, { color: theme.colors.muted }]}>
          {translate("verificationModerationSubtitle")}
        </UiText>
        <UiText style={[styles.count, { color: theme.colors.foreground }]}>
          {translate("verificationPendingCount")}: {queue.data.length}
        </UiText>
        {review.isError ? (
          <UiText style={[styles.error, { color: theme.colors.danger }]}>
            {translate("verificationReviewError")}
          </UiText>
        ) : null}
        {queue.data.length === 0 ? (
          <Card contentStyle={styles.emptyCard}>
            <UiText style={[styles.emptyTitle, { color: theme.colors.foreground }]}>
              {translate("verificationQueueEmpty")}
            </UiText>
          </Card>
        ) : queue.data.map((item) => (
          <Card key={item.id} contentStyle={styles.requestCard}>
            <View style={styles.storeHeader}>
              {item.store.logo_url ? (
                <UiImage uri={item.store.logo_url} accessibilityLabel={item.store.name} aspectRatio={1} style={styles.logo} />
              ) : null}
              <View style={styles.storeInfo}>
                <UiText style={[styles.storeName, { color: theme.colors.foreground }]}>
                  {item.store.name}
                </UiText>
                <UiText style={[styles.meta, { color: theme.colors.muted }]}>
                  {item.store.phone ?? translate("verificationMissingValue")}
                </UiText>
              </View>
            </View>
            <Detail
              label={translate("verificationRegion")}
              value={item.store.region ? getRegionDisplayName(item.store.region, language) : String(item.store.region_id)}
              theme={theme}
            />
            {item.store.secondary_region ? (
              <Detail
                label={translate("verificationSecondaryRegion")}
                value={getRegionDisplayName(item.store.secondary_region, language)}
                theme={theme}
              />
            ) : null}
            <Detail label={translate("verificationCommune")} value={item.store.commune ?? translate("verificationMissingValue")} theme={theme} />
            <Detail label={translate("verificationAddress")} value={item.store.address_line ?? translate("verificationMissingValue")} theme={theme} />
            <Detail label={translate("verificationWorkingHours")} value={item.store.opening_hours.open + " – " + item.store.opening_hours.close} theme={theme} />
            <UiText style={[styles.meta, { color: theme.colors.muted }]}>
              {translate("verificationSubmittedAt")}: {new Date(item.submitted_at).toLocaleString()}
            </UiText>
            <TextField
              value={rejectionNotes[item.id] ?? ""}
              onChangeText={(value) => setRejectionNotes((current) => ({ ...current, [item.id]: value }))}
              placeholder={translate("verificationRejectionReasonPlaceholder")}
              multiline
              editable={!review.isPending}
              style={styles.noteInput}
            />
            <View style={styles.actions}>
              <Button
                label={translate("verificationApprove")}
                onPress={() => decide(item, "approved")}
                disabled={review.isPending}
                style={styles.actionButton}
              />
              <Button
                label={translate("verificationReject")}
                onPress={() => decide(item, "rejected")}
                variant="outline"
                disabled={review.isPending || !(rejectionNotes[item.id]?.trim())}
                style={styles.actionButton}
              />
            </View>
          </Card>
        ))}
        <Button
          label={translate("merchantRetry")}
          onPress={() => void queue.refetch()}
          variant="ghost"
          disabled={queue.isFetching || review.isPending}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function Detail({ label, value, theme }: { label: string; value: string; theme: AppTheme }) {
  return (
    <View style={detailStyles.row}>
      <UiText style={[detailStyles.label, { color: theme.colors.muted }]}>{label}</UiText>
      <UiText style={[detailStyles.value, { color: theme.colors.foreground }]}>{value}</UiText>
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
    <SafeAreaView style={[stylesMessage.safe, { backgroundColor: theme.colors.background }]}>
      <View style={stylesMessage.content}>
        <AppHeader title={translate("verificationModerationTitle")} />
        {loading ? <LoadingState label={label} /> : retryLabel && onRetry ? (
          <ErrorState title={label} retryLabel={retryLabel} onRetry={onRetry} />
        ) : <UiText style={{ color: theme.colors.foreground }}>{label}</UiText>}
        <Button label={translate("merchantBackToProfile")} onPress={() => router.replace("/profile")} variant="ghost" />
      </View>
    </SafeAreaView>
  );
}

const detailStyles = StyleSheet.create({
  row: { gap: 2 },
  label: { fontSize: designTokens.typography.caption, textAlign: "auto" },
  value: { fontSize: designTokens.typography.body - 1, textAlign: "auto" }
});

const stylesMessage = StyleSheet.create({
  safe: { flex: 1 },
  content: { flex: 1, padding: designTokens.spacing.lg, gap: designTokens.spacing.md }
});

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    safe: { flex: 1 },
    content: { padding: designTokens.spacing.lg, paddingBottom: designTokens.spacing.xl, gap: designTokens.spacing.md },
    subtitle: { fontSize: designTokens.typography.caption + 1, lineHeight: 20, textAlign: "auto" },
    count: { fontSize: designTokens.typography.body, fontWeight: designTokens.fontWeights.bold },
    requestCard: { gap: designTokens.spacing.md, borderColor: theme.colors.border, borderWidth: StyleSheet.hairlineWidth },
    storeHeader: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md },
    logo: { width: 64, height: 64, borderRadius: designTokens.radius.md },
    storeInfo: { flex: 1, gap: 4 },
    storeName: { fontSize: designTokens.typography.body, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
    meta: { fontSize: designTokens.typography.caption, textAlign: "auto" },
    noteInput: { minHeight: 82, textAlignVertical: "top" },
    actions: { flexDirection: "row", gap: designTokens.spacing.sm },
    actionButton: { flex: 1 },
    emptyCard: { padding: designTokens.spacing.lg },
    emptyTitle: { fontSize: designTokens.typography.body, fontWeight: designTokens.fontWeights.bold, textAlign: "auto" },
    error: { fontSize: designTokens.typography.caption, textAlign: "auto" }
  });
}
