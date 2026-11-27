import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { formatMarketPrice, formatNumber } from "@/lib/catalog";
import {
  fetchMerchantAccess,
  fetchMerchantDashboard,
  fetchMerchantOrderDetails
} from "@/lib/merchant";
import { translate, type Language, type TranslationKey, useLanguage } from "@/lib/i18n";
import { getLocalizedWilayaLabel } from "@/lib/locale-data";
import type { MerchantDashboardOrder } from "@/lib/merchant-dashboard-state";
import { designTokens, useAppTheme, type AppTheme } from "@/lib/theme";
import { RefreshableScrollView, ErrorState, FilterBar, FilterChip, Icon, OrderCardSkeleton, MerchantStatusBadge, MerchantMetricCard, PriceDisplay, Text as UiText } from "@/components/ui";
import { MerchantStudioHeader } from "@/components/merchant-studio-header";

type OrderFilter = "all" | "pending" | "quoted" | "confirmed" | "shipped" | "delivered" | "cancelled" | "rejected";

const FILTERS: ReadonlyArray<{ value: OrderFilter; label: TranslationKey }> = [
  { value: "all", label: "merchantOrdersFilterAll" },
  { value: "pending", label: "merchantOrdersFilterPending" },
  { value: "quoted", label: "merchantOrdersFilterQuoted" },
  { value: "confirmed", label: "merchantOrdersFilterConfirmed" },
  { value: "shipped", label: "merchantOrdersFilterShipped" },
  { value: "delivered", label: "merchantOrdersFilterDelivered" },
  { value: "cancelled", label: "merchantOrdersFilterCancelled" },
  { value: "rejected", label: "merchantOrdersFilterRejected" }
];

export default function MerchantOrdersScreen() {
  const { language } = useLanguage();
  const theme = useAppTheme();
  const styles = createStyles(theme);
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [hideClosedOrders, setHideClosedOrders] = useState(true);

  const access = useQuery({
    queryKey: ["merchant-access"],
    queryFn: ({ signal }) => fetchMerchantAccess(signal),
    retry: false
  });

  const storeId = access.data?.store?.id ?? null;
  const ready = access.data?.status === "merchant_ready" && !!storeId;

  const dashboard = useQuery({
    queryKey: ["merchant-dashboard", storeId],
    queryFn: ({ signal }) => fetchMerchantDashboard(storeId ?? "", signal),
    enabled: ready,
    retry: false
  });

  useEffect(() => {
    if (!storeId) return;
    let active = true;
    void AsyncStorage.getItem(`arownd:merchant:${storeId}:hide-closed-orders`)
      .then((value) => {
        if (!active) return;
        setHideClosedOrders(value !== "show");
      })
      .catch(() => {
        if (!active) return;
        setHideClosedOrders(true);
      });
    return () => {
      active = false;
    };
  }, [storeId]);




  if (access.isPending) {
    return <LoadingScreen theme={theme} label={translate("merchantLoading")} />;
  }

  if (access.isError) {
    return (
      <MessageScreen
        theme={theme}
        title={translate("merchantLoadError")}
        actionLabel={translate("merchantRetry")}
        busy={access.isFetching}
        onAction={() => void access.refetch()}
      />
    );
  }

  if (!access.data) return <Redirect href="/login" />;
  if (!ready) return <Redirect href="/merchant" />;

  if (dashboard.isPending) {
    return <LoadingScreen theme={theme} label={translate("merchantDashboardLoading")} />;
  }

  if (dashboard.isError) {
    return (
      <MessageScreen
        theme={theme}
        title={translate("merchantDashboardError")}
        actionLabel={translate("merchantRetry")}
        busy={dashboard.isFetching}
        onAction={() => void dashboard.refetch()}
      />
    );
  }

  const availableOrders = hideClosedOrders
    ? dashboard.data.orders.filter((order) => order.status !== "cancelled" && order.status !== "rejected")
    : dashboard.data.orders;

  const visibleOrders = filter === "all"
    ? availableOrders
    : availableOrders.filter((order) => order.status === filter);

  const getFilterCount = (value: OrderFilter) => value === "all"
    ? availableOrders.length
    : availableOrders.filter((order) => order.status === value).length;
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <RefreshableScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshing={access.isFetching || dashboard.isFetching} onRefresh={() => { void Promise.all([access.refetch(), dashboard.refetch()]); }}>
        <MerchantStudioHeader sectionTitle={translate("merchantOrdersPageTitle")} onSettingsPress={() => router.push("/merchant/account-settings")} />
        <View style={styles.summaryGrid}>
          <MerchantMetricCard
            label={translate("merchantAnalyticsOrders")}
            value={formatNumber(dashboard.data.orders.length)}
            style={styles.summaryCard}
          />
          <MerchantMetricCard
            label={translate("merchantOrdersFilterPending")}
            value={formatNumber(dashboard.data.orders.filter((order) => order.status === "pending").length)}
            valueTone="warning"
            style={styles.summaryCard}
          />
        </View>

        <FilterBar style={styles.filters}>
          {FILTERS.map((item) => (
            <FilterChip
              key={item.value}
              label={`${translate(item.label)} (${formatNumber(getFilterCount(item.value))})`}
              selected={filter === item.value}
              onPress={() => setFilter(item.value)}
            />
          ))}
        </FilterBar>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: !hideClosedOrders }}
          onPress={() => {
            const nextValue = !hideClosedOrders;
            setHideClosedOrders(nextValue);
            if (storeId) {
              void AsyncStorage.setItem(`arownd:merchant:${storeId}:hide-closed-orders`, nextValue ? "hide" : "show").catch(() => undefined);
            }
          }}
          style={styles.closedOrdersToggle}
        >
          <Icon name={hideClosedOrders ? "eye" : "eye-off"} size={16} color={theme.colors.muted} />
          <UiText style={[styles.closedOrdersText, { color: theme.colors.muted }]}>
            {translate(hideClosedOrders ? "merchantShowClosedOrders" : "merchantHideClosedOrders")}
          </UiText>
        </Pressable>

        <View style={styles.listHeading}>
          <View style={[styles.countPill, { backgroundColor: theme.colors.surfaceSecondary }]}>
            <UiText style={[styles.countText, { color: theme.colors.foreground }]}>
              {formatNumber(visibleOrders.length)} / {formatNumber(dashboard.data.orders.length)}
            </UiText>
          </View>
          <UiText style={[styles.sectionTitle, { color: theme.colors.foreground }]}>
            {translate("merchantRecentOrdersTitle")}
          </UiText>
        </View>

        {visibleOrders.length === 0 ? (
          <View style={styles.emptyState}>
            <UiText style={[styles.emptyTitle, { color: theme.colors.foreground }]}>
              {filter === "all"
                ? translate("merchantOrdersEmpty")
                : translate("merchantOrdersFilterEmptyHint")}
            </UiText>
            <UiText style={[styles.subtitle, { color: theme.colors.muted }]}>
              {filter === "all" ? translate("merchantOrdersEmptyHint") : translate("merchantOrdersFilterEmpty")}
            </UiText>
          </View>
        ) : (
          <View style={styles.orderList}>
            {visibleOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                language={language}
                theme={theme}
                onPress={() => {
                  if (storeId) void queryClient.prefetchQuery({ queryKey: ["merchant-order-detail", storeId, order.id], queryFn: ({ signal }) => fetchMerchantOrderDetails(order.id, storeId, signal), staleTime: 15_000 });
                  router.push({ pathname: "/merchant/orders/[orderId]", params: { orderId: order.id } });
                }}
              />
            ))}
          </View>
        )}

        <UiText style={[styles.limitHint, { color: theme.colors.subtle }]}>
          {translate("merchantOrdersListLimitHint")}
        </UiText>
      </RefreshableScrollView>
    </SafeAreaView>
  );
}

function OrderCard({ order, language, theme, onPress }: { order: MerchantDashboardOrder; language: Language; theme: AppTheme; onPress: () => void }) {
  const style = createStyles(theme);
  const itemNames = order.productNames.length > 0
    ? order.productNames.slice(0, 2).join("، ")
    : translate("merchantOrderItems");
  const wilayaName = order.wilayaId === null
    ? (language === "ar" ? order.wilayaName : order.wilayaNameFr || order.wilayaName)
    : getLocalizedWilayaLabel(order.wilayaId, order.wilayaName, language, order.wilayaNameFr);
  const location = [order.commune, wilayaName].filter(Boolean).join("، ");
  const locale = language === "ar"
    ? "ar-DZ-u-nu-latn"
    : language === "fr"
      ? "fr-DZ-u-nu-latn"
      : "en-DZ-u-nu-latn";
  const createdDate = new Date(order.createdAt).toLocaleDateString(locale, {
    day: "numeric",
    month: "short"
  });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={translate("merchantOrderNumber") + " " + order.parentOrderId.slice(0, 8)}
      style={({ pressed }) => [style.orderRow, pressed ? style.orderRowPressed : null]}
    >
      <View style={style.orderMain}>
        <View style={style.orderTopLine}>
          <UiText style={[style.orderCode, { color: theme.colors.muted }]}>
            {translate("merchantOrderNumber")} {order.parentOrderId.slice(0, 8)}
          </UiText>
          <OrderStatus order={order} />
        </View>
        <View style={style.orderPrimaryLine}>
          <UiText numberOfLines={1} style={[style.customerName, { color: theme.colors.foreground }]}>
            {order.customerName || translate("merchantCustomerUnknown")}
          </UiText>
          <PriceDisplay value={formatMarketPrice(order.subtotal + order.shippingFee, order.currencyCode)} style={style.orderPrice} />
        </View>
        <UiText numberOfLines={1} style={[style.orderMeta, { color: theme.colors.muted }]}>
          {itemNames}
        </UiText>
        <View style={style.orderBottomLine}>
          <UiText numberOfLines={1} style={[style.orderMeta, { color: theme.colors.subtle }]}>
            {[createdDate, location, formatNumber(order.totalQuantity) + " " + translate("merchantOrderQuantity")].filter(Boolean).join(" · ")}
          </UiText>
          <Icon name="chevron-left" size={16} color={theme.colors.subtle} />
        </View>
      </View>
    </Pressable>
  );
}

function OrderStatus({ order }: { order: MerchantDashboardOrder }) {
  const labelByStatus: Record<string, TranslationKey> = {
    pending: "merchantOrderStatusPending",
    quoted: "merchantOrderStatusQuoted",
    confirmed: "merchantOrderStatusConfirmed",
    shipped: "merchantOrderStatusShipped",
    delivered: "merchantOrderStatusDelivered",
    cancelled: "merchantOrderStatusCancelled",
    rejected: "merchantOrdersFilterRejected"
  };
  const tone = order.status === "delivered"
    ? "success"
    : order.status === "cancelled"
      ? "danger"
      : order.status === "pending" || order.status === "quoted"
        ? "warning"
        : "neutral";
  const key = order.status === "shipped" && order.deliveryType === "desk"
    ? "merchantOrderStatusPrepared"
    : labelByStatus[order.status] ?? "merchantOrderStatusUnknown";

  return <MerchantStatusBadge label={translate(key)} tone={tone} />;
}

function LoadingScreen({ theme, label }: { theme: AppTheme; label: string }) {
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[stylesForScreen.safe, { backgroundColor: theme.colors.background }]}>
      <View accessible accessibilityLabel={label} style={stylesForScreen.center}>
        <MerchantStudioHeader sectionTitle={translate("merchantOrdersPageTitle")} onSettingsPress={() => router.push("/merchant/account-settings")} />
        <View style={{ width: "100%", gap: designTokens.spacing.md }}>
          {[0, 1, 2, 3].map((item) => <OrderCardSkeleton key={item} />)}
        </View>
      </View>
    </SafeAreaView>
  );
}

function MessageScreen({
  theme,
  title,
  actionLabel,
  onAction,
  busy = false
}: {
  theme: AppTheme;
  title: string;
  actionLabel: string;
  onAction: () => void;
  busy?: boolean;
}) {
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[stylesForScreen.safe, { backgroundColor: theme.colors.background }]}>
      <View style={stylesForScreen.center}>
        <MerchantStudioHeader sectionTitle={translate("merchantOrdersPageTitle")} onSettingsPress={() => router.push("/merchant/account-settings")} />
        <ErrorState title={title} retryLabel={actionLabel} busy={busy} onRetry={onAction} />
      </View>
    </SafeAreaView>
  );
}

const stylesForScreen = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, padding: designTokens.spacing.xxl, alignItems: "center", justifyContent: "center", gap: designTokens.spacing.lg },
});

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    safe: { flex: 1 },
    content: { padding: designTokens.spacing.xl, paddingBottom: designTokens.spacing.xxl, gap: designTokens.spacing.lg },
    eyebrow: { fontSize: designTokens.typography.caption, fontWeight: designTokens.fontWeights.extrabold },
    subtitle: { fontSize: designTokens.typography.caption + 1, lineHeight: 19, textAlign: "auto" },
    summaryGrid: { flexDirection: "row", gap: designTokens.spacing.sm },
    summaryCard: { minHeight: 76, justifyContent: "center", paddingVertical: designTokens.spacing.md },
    filters: { paddingVertical: designTokens.spacing.xs },
    closedOrdersToggle: { minHeight: 36, flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: designTokens.spacing.xs, paddingHorizontal: designTokens.spacing.xs },
    closedOrdersText: { fontSize: designTokens.typography.caption, fontWeight: designTokens.fontWeights.semibold },
    listHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    sectionTitle: { fontSize: designTokens.typography.body, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
    countPill: { minHeight: 30, paddingHorizontal: designTokens.spacing.md, borderRadius: designTokens.radius.pill, alignItems: "center", justifyContent: "center" },
    countText: { fontSize: designTokens.typography.caption, fontWeight: designTokens.fontWeights.extrabold, fontVariant: ["tabular-nums"] },
    orderList: { gap: 0 },
    orderRow: { minHeight: 112, paddingVertical: designTokens.spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider },
    orderRowPressed: { opacity: 0.68 },
    orderMain: { flex: 1, gap: designTokens.spacing.xs },
    orderTopLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: designTokens.spacing.sm },
    orderPrimaryLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: designTokens.spacing.md },
    orderCode: { fontSize: designTokens.typography.caption, fontWeight: designTokens.fontWeights.semibold },
    customerName: { flex: 1, fontSize: designTokens.typography.body - 1, fontWeight: designTokens.fontWeights.bold, textAlign: "auto" },
    orderMeta: { fontSize: designTokens.typography.caption, textAlign: "auto", lineHeight: 18, flexShrink: 1 },
    orderBottomLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: designTokens.spacing.sm },
    orderPrice: { alignSelf: "center" },
    emptyState: { paddingVertical: designTokens.spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider, gap: designTokens.spacing.sm, alignItems: "flex-start" },
    emptyTitle: { fontSize: designTokens.typography.body - 1, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
    limitHint: { fontSize: designTokens.typography.caption - 1, lineHeight: 16, textAlign: "auto", paddingHorizontal: designTokens.spacing.xs }
  });
}
