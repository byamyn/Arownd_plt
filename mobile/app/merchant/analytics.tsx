import { useQuery } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { formatMarketPrice, formatNumber } from "@/lib/catalog";
import { fetchMyAccountCurrencyCode } from "@/lib/country-service";
import { fetchMerchantAccess } from "@/lib/merchant";
import { fetchMerchantBusinessAnalytics } from "@/lib/merchant-analytics";
import type { MerchantAnalyticsPeriod } from "@/lib/merchant-analytics-state";
import { translate, useLanguage } from "@/lib/i18n";
import { designTokens, useAppTheme, type AppTheme } from "@/lib/theme";
import { MerchantStudioHeader } from "@/components/merchant-studio-header";
import { Button, ChartCard, DatePicker, ErrorState, Heading, MerchantMetricCard, MetricCardSkeleton, RefreshableScrollView, SegmentedControl, Skeleton, Text as UiText } from "@/components/ui";

const dateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const daysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return dateKey(date);
};

export default function MerchantAnalyticsScreen() {
  const { language } = useLanguage();
  const theme = useAppTheme();
  const styles = createStyles(theme);
  const [period, setPeriod] = useState<MerchantAnalyticsPeriod>("30d");
  const [customFrom, setCustomFrom] = useState(() => daysAgo(29));
  const [customTo, setCustomTo] = useState(() => dateKey(new Date()));
  const [appliedRange, setAppliedRange] = useState<{ from: string; to: string } | null>(null);

  const access = useQuery({ queryKey: ["merchant-access"], queryFn: ({ signal }) => fetchMerchantAccess(signal), retry: false });
  const storeId = access.data?.store?.id ?? null;
  const accountCurrency = useQuery({ queryKey: ["account-currency"], queryFn: ({ signal }) => fetchMyAccountCurrencyCode(signal), enabled: access.isSuccess && access.data?.status === "merchant_ready" });
  const ready = access.data?.status === "merchant_ready" && Boolean(storeId);
  const analyticsEnabled = Boolean(ready && (period !== "custom" || appliedRange));
  const analytics = useQuery({
    queryKey: ["merchant-business-analytics", storeId, period, appliedRange?.from, appliedRange?.to],
    queryFn: ({ signal }) => fetchMerchantBusinessAnalytics(storeId ?? "", period, appliedRange?.from, appliedRange?.to, signal),
    enabled: analyticsEnabled,
    retry: false
  });

  if (access.isPending || (ready && accountCurrency.isPending) || (analyticsEnabled && analytics.isPending)) {
    return <Message theme={theme} label={translate("merchantLoading")} loading />;
  }
  if (access.isError) {
    return <Message theme={theme} label={translate("merchantDashboardError")} actionLabel={translate("merchantRetry")} busy={access.isFetching} onAction={() => void access.refetch()} />;
  }
  if (accountCurrency.isError || (analyticsEnabled && analytics.isError)) {
    return <Message theme={theme} label={translate("merchantDashboardError")} actionLabel={translate("merchantRetry")} busy={analytics.isFetching || accountCurrency.isFetching} onAction={() => { void analytics.refetch(); void accountCurrency.refetch(); }} />;
  }
  if (!access.data) return <Redirect href="/login" />;
  if (access.data.teamRole === "staff") return <Redirect href="/merchant/orders" />;
  if (!ready || !accountCurrency.data) return <Redirect href="/merchant" />;

  const data = analytics.data;
  const periodOptions = [
    { key: "7d", label: translate("merchantBusiness7Days") },
    { key: "30d", label: translate("merchantBusiness30Days") },
    { key: "90d", label: translate("merchantBusiness90Days") },
    { key: "custom", label: translate("merchantBusinessCustom") }
  ];
  const dateRangeValid = customFrom <= customTo && (new Date(`${customTo}T00:00:00`).getTime() - new Date(`${customFrom}T00:00:00`).getTime()) / 86400000 <= 364;
  const maxDaily = Math.max(1, ...(data?.daily_sales ?? []).map((item) => item.amount));
  const orderCards = data ? [
    { label: translate("merchantAnalyticsOrders"), value: formatNumber(data.orders_total), tone: "default" as const },
    { label: translate("merchantAnalyticsDelivered"), value: formatNumber(data.delivered_orders), tone: "success" as const },
    { label: translate("merchantAnalyticsActive"), value: formatNumber(data.active_orders), tone: "warning" as const },
    { label: translate("merchantAnalyticsCancelled"), value: formatNumber(data.cancelled_orders), tone: "danger" as const },
    { label: translate("merchantBusinessRejected"), value: formatNumber(data.rejected_orders), tone: "danger" as const }
  ] : [];

  const weekdayLabels = translate("merchantBusinessWeekdays").split(",");
  const formatMonth = (year: number, month: number) => new Intl.DateTimeFormat(language === "ar" ? "ar-DZ" : "en-DZ", { month: "long", year: "numeric" }).format(new Date(year, month, 1));

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <RefreshableScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshing={access.isFetching || analytics.isFetching} onRefresh={() => { void Promise.all([access.refetch(), analyticsEnabled ? analytics.refetch() : Promise.resolve(undefined)]); }}>
        <MerchantStudioHeader sectionTitle={translate("merchantAnalyticsTitle")} onSettingsPress={() => router.push("/merchant/account-settings")} />

        <Heading level={3}>{translate("merchantBusinessPerformance")}</Heading>
        <UiText style={[styles.sectionLabel, { color: theme.colors.muted }]}>{translate("merchantBusinessPeriod")}</UiText>
        <SegmentedControl
          options={periodOptions}
          value={period}
          accessibilityLabel={translate("merchantBusinessPeriod")}
          onChange={(value) => {
            const next = value as MerchantAnalyticsPeriod;
            setPeriod(next);
            if (next === "custom") setAppliedRange(null);
          }}
        />

        {period === "custom" ? (
          <View style={[styles.datePanel, { borderColor: theme.colors.divider }]}>
            <UiText style={[styles.sectionLabel, { color: theme.colors.foreground }]}>{translate("merchantBusinessFrom")}</UiText>
            <DatePicker value={customFrom} onChange={(value) => { setCustomFrom(value); setAppliedRange(null); }} accessibilityLabel={translate("merchantBusinessFrom")} monthLabel={formatMonth} weekdayLabels={weekdayLabels} previousMonthLabel={translate("merchantBusinessPreviousMonth")} nextMonthLabel={translate("merchantBusinessNextMonth")} maxDate={customTo} />
            <UiText style={[styles.sectionLabel, { color: theme.colors.foreground }]}>{translate("merchantBusinessTo")}</UiText>
            <DatePicker value={customTo} onChange={(value) => { setCustomTo(value); setAppliedRange(null); }} accessibilityLabel={translate("merchantBusinessTo")} monthLabel={formatMonth} weekdayLabels={weekdayLabels} previousMonthLabel={translate("merchantBusinessPreviousMonth")} nextMonthLabel={translate("merchantBusinessMonth")} minDate={customFrom} maxDate={dateKey(new Date())} />
            {!dateRangeValid ? <UiText style={[styles.validation, { color: theme.colors.danger }]}>{translate("merchantBusinessDateRangeError")}</UiText> : null}
            <Button label={translate("merchantBusinessApply")} onPress={() => setAppliedRange({ from: customFrom, to: customTo })} disabled={!dateRangeValid} fullWidth />
          </View>
        ) : null}

        {!data ? (
          <UiText style={[styles.empty, { color: theme.colors.muted }]}>{translate("merchantBusinessNoOrders")}</UiText>
        ) : (
          <>
            <View style={styles.overviewHeader}>
              <UiText style={[styles.overviewEyebrow, { color: theme.colors.muted }]}>{translate("merchantBusinessRevenue")}</UiText>
              <UiText style={[styles.overviewValue, { color: theme.colors.foreground }]}>{formatMarketPrice(data.revenue, accountCurrency.data)}</UiText>
              <UiText style={[styles.overviewCaption, { color: theme.colors.muted }]}>{translate("merchantAnalyticsRevenueNote")}</UiText>
              <View style={styles.comparisonRow}>
                <UiText style={[styles.comparisonValue, { color: data.revenue_change_percent === null ? theme.colors.muted : data.revenue_change_percent >= 0 ? theme.colors.success : theme.colors.danger }]}>
                  {data.revenue_change_percent === null ? translate("merchantBusinessNoComparison") : `${data.revenue_change_percent > 0 ? "+" : ""}${data.revenue_change_percent}%`}
                </UiText>
                <UiText style={[styles.overviewCaption, { color: theme.colors.muted }]}>{translate("merchantBusinessGrowth")}</UiText>
              </View>
              <UiText style={[styles.overviewCaption, { color: theme.colors.muted }]}>{translate("merchantBusinessPrevious")}: {formatMarketPrice(data.previous_revenue, accountCurrency.data)}</UiText>
            </View>

            <View style={styles.grid}>
              <MerchantMetricCard label={translate("merchantAnalyticsAverage")} value={formatMarketPrice(data.average_order, accountCurrency.data)} style={styles.metricCard} />
              <MerchantMetricCard label={translate("merchantBusinessDeliveryRate")} value={`${data.delivery_rate_percent}%`} valueTone="success" style={styles.metricCard} />
              <MerchantMetricCard label={translate("merchantBusinessCancellationRate")} value={`${data.cancellation_rate_percent}%`} valueTone="danger" style={styles.metricCard} />
            </View>

            <Heading level={3}>{translate("merchantAnalyticsOrders")}</Heading>
            <View style={styles.grid}>
              {orderCards.map((card) => <MerchantMetricCard key={card.label} label={card.label} value={card.value} valueTone={card.tone} style={styles.metricCard} />)}
            </View>

            <Heading level={3}>{translate("merchantBusinessSalesTrend")}</Heading>
            <ChartCard style={styles.chartCard}>
              {data.daily_sales.every((item) => item.amount === 0) ? (
                <UiText style={[styles.empty, { color: theme.colors.muted }]}>{translate("merchantAnalyticsNoSales")}</UiText>
              ) : data.daily_sales.map((item) => (
                <View key={item.day} style={styles.dayRow}>
                  <UiText style={[styles.dayLabel, { color: theme.colors.muted }]}>{new Intl.DateTimeFormat(language === "ar" ? "ar-DZ" : "en-DZ", { day: "numeric", month: "short" }).format(new Date(item.day + "T12:00:00"))}</UiText>
                  <View style={[styles.track, { backgroundColor: theme.mode === "dark" ? theme.colors.surfaceSecondary : theme.colors.surfaceMuted }]}>
                    <View style={[styles.bar, { backgroundColor: theme.colors.accent, width: `${Math.max(item.amount > 0 ? 3 : 0, item.amount / maxDaily * 100)}%` }]} />
                  </View>
                  <UiText numberOfLines={1} adjustsFontSizeToFit style={[styles.amount, { color: theme.colors.foreground }]}>{formatMarketPrice(item.amount, accountCurrency.data)}</UiText>
                </View>
              ))}
            </ChartCard>

            <Heading level={3}>{translate("merchantBusinessTopProducts")}</Heading>
            <View style={styles.listSection}>
              {data.top_products.length === 0 ? <UiText style={[styles.empty, { color: theme.colors.muted }]}>{translate("merchantBusinessNoProducts")}</UiText> : data.top_products.map((product, index) => (
                <View key={`${product.name}-${index}`} style={[styles.productRow, { borderBottomColor: theme.colors.divider }]}>
                  <View style={styles.productInfo}>
                    <UiText numberOfLines={2} style={[styles.productName, { color: theme.colors.foreground }]}>{product.name}</UiText>
                    <UiText style={[styles.productHint, { color: theme.colors.muted }]}>{formatNumber(product.units_sold)} {translate("merchantBusinessUnitsSold")}</UiText>
                  </View>
                  <UiText style={[styles.productRevenue, { color: theme.colors.foreground }]}>{formatMarketPrice(product.revenue, accountCurrency.data)}</UiText>
                </View>
              ))}
            </View>

            <Heading level={3}>{translate("merchantBusinessSlowProducts")}</Heading>
            <View style={styles.listSection}>
              {data.slow_products.length === 0 ? <UiText style={[styles.empty, { color: theme.colors.muted }]}>{translate("merchantBusinessNoSlowProducts")}</UiText> : data.slow_products.map((product, index) => (
                <View key={`${product.name}-${index}`} style={[styles.productRow, { borderBottomColor: theme.colors.divider }]}>
                  <UiText numberOfLines={2} style={[styles.productName, styles.productInfo, { color: theme.colors.foreground }]}>{product.name}</UiText>
                  <UiText style={[styles.productHint, { color: theme.colors.muted }]}>{translate("merchantAnalyticsProducts")}: {formatNumber(product.stock_quantity)}</UiText>
                </View>
              ))}
            </View>

            <Heading level={3}>{translate("merchantBusinessInventory")}</Heading>
            <View style={styles.grid}>
              <MerchantMetricCard label={translate("merchantAnalyticsProducts")} value={formatNumber(data.product_count)} style={styles.metricCard} />
              <MerchantMetricCard label={translate("merchantAnalyticsLowStock")} value={formatNumber(data.low_stock_count)} valueTone="warning" style={styles.metricCard} />
              <MerchantMetricCard label={translate("merchantAnalyticsOutOfStock")} value={formatNumber(data.out_of_stock_count)} valueTone="danger" style={styles.metricCard} />
            </View>

            <Heading level={3}>{translate("merchantBusinessInsights")}</Heading>
            <View style={styles.insights}>
              {data.revenue_change_percent !== null ? (
                <UiText style={[styles.insightText, { color: theme.colors.foreground }]}>
                  {data.revenue_change_percent > 0 ? translate("merchantBusinessSalesUp") : data.revenue_change_percent < 0 ? translate("merchantBusinessSalesDown") : translate("merchantBusinessSalesFlat")}
                </UiText>
              ) : null}
              {data.low_stock_count + data.out_of_stock_count > 0 ? <UiText style={[styles.insightText, { color: theme.colors.warning }]}>{translate("merchantBusinessStockAlert")}</UiText> : null}
              {data.estimated_delivery_dates > 0 ? <UiText style={[styles.insightText, { color: theme.colors.muted }]}>{translate("merchantBusinessEstimatedDates")}</UiText> : null}
              {data.revenue_change_percent === null && data.low_stock_count + data.out_of_stock_count === 0 && data.estimated_delivery_dates === 0 ? <UiText style={[styles.insightText, { color: theme.colors.muted }]}>{translate("merchantBusinessNoComparison")}</UiText> : null}
            </View>
          </>
        )}
      </RefreshableScrollView>
    </SafeAreaView>
  );
}

function Message({ theme, label, loading = false, actionLabel, onAction, busy = false }: {
  theme: AppTheme; label: string; loading?: boolean; actionLabel?: string; onAction?: () => void; busy?: boolean;
}) {
  const styles = createStyles(theme);
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <View style={styles.message}>
        <MerchantStudioHeader sectionTitle={translate("merchantAnalyticsTitle")} onSettingsPress={() => router.push("/merchant/account-settings")} />
        {loading ? (
          <View style={{ width: "100%", gap: designTokens.spacing.md }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: designTokens.spacing.sm }}>
              {[0, 1, 2, 3].map((item) => <MetricCardSkeleton key={item} style={{ width: "47%", flex: 0 }} />)}
            </View>
            <View style={{ gap: designTokens.spacing.sm, padding: designTokens.spacing.md }}>
              {[0, 1, 2, 3, 4, 5, 6].map((item) => <Skeleton key={item} height={9} width={`${55 + item * 5}%`} radius={designTokens.radius.pill} />)}
            </View>
          </View>
        ) : actionLabel && onAction ? (
          <ErrorState title={label} retryLabel={actionLabel} busy={busy} onRetry={onAction} />
        ) : (
          <UiText style={[styles.subtitle, { color: theme.colors.foreground }]}>{label}</UiText>
        )}
      </View>
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    safe: { flex: 1 },
    content: { padding: designTokens.spacing.xl, paddingBottom: designTokens.spacing.xxl, gap: designTokens.spacing.lg },
    overviewHeader: { paddingVertical: designTokens.spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider, gap: designTokens.spacing.sm },
    overviewEyebrow: { fontSize: designTokens.typography.caption, fontWeight: "600", textAlign: "auto" },
    overviewValue: { fontSize: 30, lineHeight: 38, fontWeight: "800", textAlign: "auto", fontVariant: ["tabular-nums"] },
    overviewCaption: { fontSize: designTokens.typography.caption - 1, lineHeight: 18, textAlign: "auto" },
    sectionLabel: { fontSize: designTokens.typography.caption + 1, fontWeight: "600", textAlign: "auto" },
    subtitle: { fontSize: designTokens.typography.caption + 1, lineHeight: 20, textAlign: "auto" },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: designTokens.spacing.sm },
    metricCard: { width: "48%", flexGrow: 1, minHeight: 92, justifyContent: "center" },
    comparisonRow: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.sm },
    comparisonValue: { fontSize: designTokens.typography.body, fontWeight: "800", fontVariant: ["tabular-nums"] },
    datePanel: { borderWidth: 1, borderRadius: theme.radius.lg, padding: designTokens.spacing.md, gap: designTokens.spacing.md },
    validation: { fontSize: designTokens.typography.caption, textAlign: "auto" },
    chartCard: { gap: designTokens.spacing.md },
    dayRow: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.sm },
    dayLabel: { width: 48, fontSize: designTokens.typography.caption - 1, textAlign: "auto" },
    track: { flex: 1, minWidth: 0, height: 9, borderRadius: theme.radius.pill, overflow: "hidden" },
    bar: { height: 9, borderRadius: theme.radius.pill },
    amount: { minWidth: 54, maxWidth: 104, flexShrink: 1, fontSize: designTokens.typography.caption - 2, textAlign: "auto" },
    listSection: { gap: 0 },
    productRow: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md, paddingVertical: designTokens.spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
    productInfo: { flex: 1, gap: designTokens.spacing.xs },
    productName: { fontSize: designTokens.typography.body, fontWeight: "600", textAlign: "auto" },
    productHint: { fontSize: designTokens.typography.caption, textAlign: "auto" },
    productRevenue: { fontSize: designTokens.typography.caption + 1, fontWeight: "700", textAlign: "auto" },
    insights: { gap: designTokens.spacing.sm },
    insightText: { fontSize: designTokens.typography.caption + 1, lineHeight: 20, textAlign: "auto" },
    empty: { textAlign: "center", fontSize: designTokens.typography.caption, paddingVertical: designTokens.spacing.md },
    message: { flex: 1, justifyContent: "center", padding: designTokens.spacing.lg, gap: designTokens.spacing.lg }
  });
}
