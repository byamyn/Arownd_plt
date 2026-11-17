import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import {
  ScrollView,
  StyleSheet,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  fetchMerchantAccess,
  fetchMerchantDashboard,
  fetchMerchantOrderDetails
} from "@/lib/merchant";
import { fetchStoreDetails, fetchStoreOffers, formatMarketPrice } from "@/lib/catalog";
import { translate, type TranslationKey, useLanguage } from "@/lib/i18n";
import { VerifiedBadge } from "@/components/ui/identity";
import { designTokens, useAppTheme, type AppTheme } from "@/lib/theme";
import type { MerchantDashboardOrder } from "@/lib/merchant-dashboard-state";
import { RefreshableScrollView, AppHeader, Button, Card, ErrorState, Icon, IconButton, Image as UiImage, MetricCardSkeleton, OrderCardSkeleton, MerchantStatusBadge, PriceDisplay, PressableSurface, Text as UiText } from "@/components/ui";

export default function MerchantEntryScreen() {
  useLanguage();
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const styles = createStyles(theme);

  const access = useQuery({
    queryKey: ["merchant-access"],
    queryFn: fetchMerchantAccess,
    retry: false
  });

  const storeId = access.data?.store?.id ?? null;
  const isMerchantReady = access.data?.status === "merchant_ready" && !!storeId;

  const dashboard = useQuery({
    queryKey: ["merchant-dashboard", storeId],
    queryFn: () => fetchMerchantDashboard(storeId ?? ""),
    enabled: isMerchantReady,
    retry: false
  });

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

  if (access.data.status === "personal" || access.data.status === "merchant_setup_required") {
    return (
      <SafeAreaView edges={["top", "left", "right"]} style={[styles.safe, { backgroundColor: theme.colors.background }]}>
        <ScrollView contentContainerStyle={styles.entryContent}>
          <Button label={translate("merchantBackToProfile")} onPress={() => router.replace("/profile")} variant="ghost" size="sm" />
          <View style={[styles.entryCard, { backgroundColor: theme.mode === "light" ? theme.colors.surfaceSecondary : theme.colors.surface, borderColor: theme.mode === "light" ? "transparent" : theme.colors.border }]}>
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
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (access.data.status !== "merchant_ready" || !storeId) {
    const message = translate("merchantStatusInconsistentHint");

    return (
      <MessageScreen
        theme={theme}
        title={message}
        actionLabel={translate("merchantBackToProfile")}
        onAction={() => router.replace("/profile")}
      />
    );
  }

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

  const data = dashboard.data;
  const recentOrders = data.orders.filter((order) => order.status === "pending").slice(0, 5);

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <RefreshableScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshing={access.isFetching || dashboard.isFetching} onRefresh={() => { void Promise.all([access.refetch(), dashboard.refetch()]); }}>
        <AppHeader
          title={translate("merchantDashboardTitle")}
          trailing={
            <IconButton
              icon={<Icon name="settings" size={20} color={theme.colors.foreground} accessibilityHidden />}
              accessibilityLabel={translate("settingsTitle")}
              onPress={() => router.push("/merchant/account-settings")}
              variant="surface"
            />
          }
        />

        <Card style={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderWidth: 1 }} contentStyle={styles.storeCard}>
          <View style={styles.storeHeader}>
            <View style={[styles.storeAvatar, { backgroundColor: theme.colors.surfaceSecondary, borderColor: theme.colors.border }]}>
              {data.store.logo_url ? (
                <UiImage uri={data.store.logo_url} accessibilityLabel={data.store.name} aspectRatio={1} style={styles.storeImage} />
              ) : (
                <Icon name="store" color={theme.colors.accentMuted} size={28} accessibilityHidden />
              )}
            </View>
            <View style={styles.storeInfo}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: designTokens.spacing.xs }}>
                <UiText style={[styles.storeName, { color: theme.colors.foreground, flexShrink: 1 }]} numberOfLines={2}>{data.store.name}</UiText>
                {data.store.is_verified ? <VerifiedBadge size={18} accessibilityLabel={translate("storeVerified")} /> : null}
              </View>
              <UiText style={[styles.storeMeta, { color: theme.colors.muted }]} numberOfLines={1}>
                {data.store.commune || translate("merchantStoreLocationMissing")}
              </UiText>
              <View style={styles.storeBadges}>
                <View style={[styles.statusPill, { backgroundColor: theme.colors.surfaceSecondary }]}>
                  <UiText style={[styles.statusPillText, { color: theme.colors.muted }]}>
                    {translate("merchantStoreRating")}: {data.store.rating == null ? "—" : data.store.rating.toFixed(1)}
                  </UiText>
                </View>
              </View>
            </View>
          </View>
          <View style={styles.storeActions}>
            <Button label={translate("merchantMyStore")} onPress={() => {
              void queryClient.prefetchQuery({ queryKey: ["customer-store", data.store.id], queryFn: () => fetchStoreDetails(data.store.id), staleTime: 60_000 });
              void queryClient.prefetchQuery({ queryKey: ["customer-store-offers", data.store.id], queryFn: () => fetchStoreOffers(data.store.id), staleTime: 30_000 });
              router.push({ pathname: "/store/[storeId]", params: { storeId: data.store.id } });
            }} variant="outline" size="sm" style={{ flex: 1 }} />
            <Button label={translate("merchantStoreSettingsTitle")} onPress={() => router.push("/merchant/settings")} variant="outline" size="sm" style={{ flex: 1 }} startIcon={<Icon name="settings" size={16} color={theme.colors.foreground} accessibilityHidden />} />
          </View>
        </Card>

        <View style={styles.sectionHeading}>
          <View style={styles.sectionHeadingText}>
            <UiText style={[styles.sectionTitle, { color: theme.colors.foreground }]}>
              {translate("merchantRecentOrdersTitle")}
            </UiText>
            <UiText style={[styles.sectionHint, { color: theme.colors.muted }]}>
              {translate("merchantRecentOrdersHint")}
            </UiText>
          </View>
          <Button label={translate("merchantViewAllOrders")} onPress={() => router.push("/merchant/orders")} variant="ghost" size="sm" />
        </View>

        {recentOrders.length === 0 ? (
          <Card style={{ backgroundColor: theme.mode === "light" ? theme.colors.surfaceSecondary : theme.colors.surface }} contentStyle={styles.emptyCard}>
            <UiText style={[styles.emptyTitle, { color: theme.colors.foreground }]}>
              {translate("merchantOrdersEmpty")}
            </UiText>
            <UiText style={[styles.body, { color: theme.colors.muted }]}>
              {translate("merchantOrdersEmptyHint")}
            </UiText>
          </Card>
        ) : (
          <Card style={{ backgroundColor: theme.mode === "light" ? theme.colors.surfaceSecondary : theme.colors.surface }} contentStyle={styles.ordersCard}>
            {recentOrders.map((order, index) => (
              <PressableSurface
                key={order.id}
                accessibilityRole="button"
                accessibilityLabel={`${translate("merchantOrderNumber")} ${order.parentOrderId.slice(0, 8)}، ${order.customerName || translate("merchantCustomerUnknown")}، ${formatMarketPrice(order.subtotal + order.shippingFee, order.currencyCode)}`}
                onPress={() => {
                  if (storeId) void queryClient.prefetchQuery({ queryKey: ["merchant-order-detail", storeId, order.id], queryFn: () => fetchMerchantOrderDetails(order.id, storeId), staleTime: 15_000 });
                  router.push({ pathname: "/merchant/orders/[orderId]", params: { orderId: order.id } });
                }}
                style={[
                  styles.orderRow,
                  index < recentOrders.length - 1 && { borderBottomColor: theme.colors.border, borderBottomWidth: StyleSheet.hairlineWidth }
                ]}
              >
                <View style={styles.orderMain}>
                  <View style={styles.orderTopLine}>
                    <UiText style={[styles.orderCode, { color: theme.colors.foreground }]}>
                      {`${translate("merchantOrderNumber")} ${order.parentOrderId.slice(0, 8)}`}
                    </UiText>
                    <OrderStatus order={order} />
                  </View>
                  <UiText style={[styles.orderCustomer, { color: theme.colors.muted }]} numberOfLines={1}>
                    {order.customerName || translate("merchantCustomerUnknown")}
                  </UiText>
                  <UiText style={[styles.orderItems, { color: theme.colors.muted }]} numberOfLines={2}>
                    {order.productNames.join("، ") || translate("merchantOrderItems")}
                    {" · "}
                    {`${order.totalQuantity} ${translate("merchantOrderQuantity")}`}
                  </UiText>
                </View>
                <PriceDisplay value={formatMarketPrice(order.subtotal + order.shippingFee, order.currencyCode)} />
                <UiText style={[styles.textButtonLabel, { color: theme.colors.accentMuted }]}>
                  {translate("merchantOrderDetailTitle")} ←
                </UiText>
              </PressableSurface>
            ))}
          </Card>
        )}


      </RefreshableScrollView>
    </SafeAreaView>
  );
}

function OrderStatus({ order }: { order: MerchantDashboardOrder }) {
  const labelByStatus: Record<string, TranslationKey> = {
    pending: "merchantOrderStatusPending",
    quoted: "merchantOrderStatusQuoted",
    confirmed: "merchantOrderStatusConfirmed",
    shipped: "merchantOrderStatusShipped",
    delivered: "merchantOrderStatusDelivered",
    cancelled: "merchantOrderStatusCancelled"
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
        <View style={{ width: "100%", gap: designTokens.spacing.md }}>
          <View style={{ flexDirection: "row", gap: designTokens.spacing.sm }}>
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </View>
          <View style={{ flexDirection: "row", gap: designTokens.spacing.sm }}>
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </View>
          <OrderCardSkeleton />
          <OrderCardSkeleton />
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
        <ErrorState title={title} retryLabel={actionLabel} busy={busy} onRetry={onAction} />
      </View>
    </SafeAreaView>
  );
}

const stylesForScreen = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, padding: designTokens.spacing.xxl, alignItems: "center", justifyContent: "center", gap: designTokens.spacing.lg },
  message: { fontSize: designTokens.typography.body, lineHeight: 22, textAlign: "center", fontWeight: designTokens.fontWeights.bold },
  action: { minHeight: 46, borderRadius: designTokens.radius.md, paddingHorizontal: designTokens.spacing.xl, alignItems: "center", justifyContent: "center" },
  actionText: { fontSize: designTokens.typography.body - 1, fontWeight: designTokens.fontWeights.extrabold },
});

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    safe: { flex: 1 },
    content: { padding: designTokens.spacing.xl, paddingBottom: designTokens.spacing.xxl, gap: designTokens.spacing.xl },
    dashboardHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: designTokens.spacing.md },
    entryContent: { flexGrow: 1, padding: designTokens.spacing.xl, gap: designTokens.spacing.xl },
    header: { alignItems: "flex-start", gap: designTokens.spacing.sm },
    backButton: { minHeight: 42, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 3 },
    backText: { fontSize: designTokens.typography.caption + 1, fontWeight: designTokens.fontWeights.extrabold },
    eyebrow: { fontSize: designTokens.typography.caption, fontWeight: designTokens.fontWeights.extrabold },
    title: { fontSize: designTokens.typography.display - 4, lineHeight: 33, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
    body: { fontSize: designTokens.typography.caption + 1, lineHeight: 20, textAlign: "auto" },
    entryCard: { borderWidth: theme.mode === "light" ? 0 : 1, borderRadius: designTokens.radius.lg, padding: designTokens.spacing.xl, gap: designTokens.spacing.lg },
    storeCard: { borderWidth: theme.mode === "light" ? 0 : 1, borderRadius: designTokens.radius.lg, padding: designTokens.spacing.lg, gap: designTokens.spacing.lg },
    storeHeader: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md },
    storeAvatar: { width: 58, height: 58, borderWidth: 1, borderRadius: designTokens.radius.pill, overflow: "hidden", alignItems: "center", justifyContent: "center" },
    storeActions: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.sm },
    storeImage: { width: "100%", height: "100%" },
    storeAvatarText: { fontSize: designTokens.typography.display - 4, fontWeight: designTokens.fontWeights.extrabold },
    storeInfo: { flex: 1, alignItems: "flex-start", gap: designTokens.spacing.xs },
    storeName: { fontSize: designTokens.typography.subtitle + 1, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
    storeMeta: { fontSize: designTokens.typography.caption, textAlign: "auto" },
    storeBadges: { flexDirection: "row", flexWrap: "wrap", gap: designTokens.spacing.xs, marginTop: 3 },
    statusPill: { borderRadius: designTokens.radius.pill, paddingHorizontal: designTokens.spacing.sm, paddingVertical: designTokens.spacing.xs },
    statusPillText: { fontSize: designTokens.typography.caption - 1, fontWeight: designTokens.fontWeights.extrabold },
    secondaryButton: { minHeight: 43, borderWidth: 1, borderRadius: designTokens.radius.sm, alignItems: "center", justifyContent: "center" },
    secondaryButtonText: { fontSize: designTokens.typography.caption + 1, fontWeight: designTokens.fontWeights.extrabold },
    sectionHeading: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: designTokens.spacing.md, marginTop: designTokens.spacing.xs },
    sectionHeadingText: { flex: 1, alignItems: "flex-start", gap: designTokens.spacing.xs },
    sectionTitle: { fontSize: designTokens.typography.subtitle - 1, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
    sectionHint: { fontSize: designTokens.typography.caption - 1, lineHeight: 16, textAlign: "auto" },
    textButton: { minHeight: 40, justifyContent: "center", paddingHorizontal: 3 },
    textButtonLabel: { fontSize: designTokens.typography.caption, fontWeight: designTokens.fontWeights.extrabold },
    ordersCard: { borderWidth: theme.mode === "light" ? 0 : 1, borderRadius: designTokens.radius.md, overflow: "hidden" },
    orderRow: { paddingHorizontal: designTokens.spacing.md, paddingVertical: designTokens.spacing.md, flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md },
    orderMain: { flex: 1, alignItems: "flex-start", gap: designTokens.spacing.xs },
    orderTopLine: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: designTokens.spacing.sm },
    orderCode: { fontSize: designTokens.typography.caption, fontWeight: designTokens.fontWeights.extrabold },
    orderCustomer: { width: "100%", fontSize: designTokens.typography.caption, textAlign: "auto" },
    orderItems: { width: "100%", fontSize: designTokens.typography.caption - 1, lineHeight: 15, textAlign: "auto" },
    orderAmount: { fontSize: designTokens.typography.caption, fontWeight: designTokens.fontWeights.extrabold },
    emptyCard: { borderWidth: theme.mode === "light" ? 0 : 1, borderRadius: designTokens.radius.md, padding: designTokens.spacing.xl, gap: designTokens.spacing.sm, alignItems: "flex-start" },
    emptyTitle: { fontSize: designTokens.typography.body - 1, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
    primaryButton: { minHeight: 50, borderRadius: designTokens.radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: designTokens.spacing.lg },
    primaryButtonText: { fontSize: designTokens.typography.body - 1, fontWeight: designTokens.fontWeights.extrabold }
  });
}
