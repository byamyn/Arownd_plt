import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";

import { CustomerScreen, EmptyState, ErrorState, PageSkeleton } from "@/components/customer-ui";
import { AppHeader, Caption, PressableSurface, Text as UiText } from "@/components/ui";
import { fetchMerchantOrderDisputeInbox } from "@/lib/merchant-order-disputes";
import { translate, useLanguage } from "@/lib/i18n";
import { designTokens, useAppTheme } from "@/lib/theme";

function dateLabel(value: string, language: "ar" | "en"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "ar" ? "ar-DZ" : "en-DZ", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

export default function SupportDisputeInboxScreen() {
  const theme = useAppTheme();
  const styles = createStyles(theme);
  const { language } = useLanguage();
  const query = useQuery({
    queryKey: ["merchant-order-dispute-inbox"],
    queryFn: ({ signal }) => fetchMerchantOrderDisputeInbox(signal),
    retry: false,
    refetchInterval: 45_000
  });

  return (
    <CustomerScreen
      showNavigation={false}
      onRefresh={() => { void query.refetch(); }}
      refreshing={query.isFetching}
    >
      <AppHeader title={translate("disputeSupportInboxTitle")} />
      <UiText style={styles.subtitle}>{translate("disputeSupportInboxHint")}</UiText>
      {query.isPending ? <PageSkeleton variant="list" rows={5} /> : null}
      {query.isError ? <ErrorState title={translate("disputeLoadError")} retryLabel={translate("retry")} onRetry={() => { void query.refetch(); }} busy={query.isFetching} /> : null}
      {query.isSuccess && query.data.length === 0 ? <EmptyState icon="message-circle" title={translate("disputeSupportInboxEmpty")} hint={translate("disputeSupportInboxEmptyHint")} /> : null}
      {(query.data ?? []).map((item) => (
        <PressableSurface
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={translate("disputeOpenConversation")}
          onPress={() => router.push(("/support/disputes/" + item.id) as never)}
          style={styles.item}
        >
          <View style={styles.itemTop}>
            <UiText weight="800">{translate("orderDisputeTicket")}</UiText>
            <Caption>{translate(item.status === "resolved" ? "orderDisputeStatusResolved" : item.status === "in_review" ? "orderDisputeStatusInReview" : "orderDisputeStatusOpen")}</Caption>
          </View>
          <UiText numberOfLines={2}>{item.reason}</UiText>
          <View style={styles.itemBottom}>
            <Caption>{translate("ordersCode")}: {item.order_id.slice(0, 8).toUpperCase()}</Caption>
            <Caption>{dateLabel(item.updated_at, language)}</Caption>
          </View>
        </PressableSurface>
      ))}
    </CustomerScreen>
  );
}

function createStyles(theme: ReturnType<typeof useAppTheme>) {
  return StyleSheet.create({
    subtitle: { color: theme.colors.foregroundSecondary, fontSize: designTokens.typography.caption, lineHeight: 20 },
    item: { padding: designTokens.spacing.md, borderRadius: designTokens.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, gap: designTokens.spacing.sm },
    itemTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: designTokens.spacing.sm },
    itemBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: designTokens.spacing.sm, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: designTokens.spacing.sm }
  });
}
