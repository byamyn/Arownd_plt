import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import {
  Caption,
  Card,
  Heading,
  Icon,
  Image,
  OrderCard,
  OrderStatusBadge,
  PriceDisplay,
  RatingStars,
  SegmentedControl,
  StatusBadge,
  StoreCard,
  Text as UiText
} from "@/components/ui";
import { EmptyState, ErrorState, ProductTile } from "@/components/customer-ui";
import { FavoriteButton as FavoriteToggle } from "@/components/favorite-button";
import { chooseBestProductOffer, fetchProductDetails, fetchProductOffers, fetchStoreDetails, fetchStoreOffers, formatMarketPrice, formatNumber, getPrimaryImage } from "@/lib/catalog";
import { BROWSING_CURRENCY_QUERY_KEY, fetchBrowsingCurrencyCode } from "@/lib/country-service";
import { FAVORITES_QUERY_KEY } from "@/components/favorite-button";
import { getFavorites } from "@/lib/favorites";
import type { FavoriteKind } from "@/lib/favorites-state";
import { fetchMyOrders, fetchCustomerOrderDetails, getOrderStatusTone,  } from "@/lib/orders";
import { formatOrderCode } from "@/lib/orders-state";
import { fetchMyReviews, getReviewTargetPath, type AppReview } from "@/lib/reviews";
import { translate, type Language, useLanguage } from "@/lib/i18n";
import { designTokens, useAppTheme } from "@/lib/theme";

export type ProfileActivitySection = "orders" | "favorites" | "reviews";

type OrdersTab = "all" | "active" | "delivered" | "cancelled";

function orderStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "orderStatusPending",
    quoted: "orderStatusQuoted",
    confirmed: "orderStatusConfirmed",
    shipped: "orderStatusShipped",
    delivered: "orderStatusDelivered",
    cancelled: "orderStatusCancelled",
    rejected: "orderStatusRejected"
  } as const;
  return translate((labels[status] ?? "orderStatusUnknown") as Parameters<typeof translate>[0]);
}

export function ProfileActivitySheet({ section, onNavigate }: { section: ProfileActivitySection; onNavigate: () => void }) {
  useLanguage();
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      {section === "orders" ? <OrdersContent onNavigate={onNavigate} /> : section === "favorites" ? <FavoritesContent onNavigate={onNavigate} /> : <ReviewsContent onNavigate={onNavigate} />}
    </View>
  );
}

function OrdersContent({ onNavigate }: { onNavigate: () => void }) {
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<OrdersTab>("all");
  const orders = useQuery({ queryKey: ["my-orders"], queryFn: ({ signal }) => fetchMyOrders(signal) });

  const rows = useMemo(() => (orders.data ?? []).flatMap((order) => {
    if (order.merchant_orders.length === 0) {
      return [{ key: order.id, order, status: order.status, storeName: null as string | null, subtotal: order.subtotal, shippingFee: order.shipping_fee, itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0) }];
    }
    return order.merchant_orders.map((merchantOrder) => ({
      key: merchantOrder.id,
      order,
      status: merchantOrder.status,
      storeName: merchantOrder.store?.name ?? null,
      subtotal: merchantOrder.subtotal,
      shippingFee: merchantOrder.shipping_fee,
      itemCount: merchantOrder.items.reduce((sum, item) => sum + item.quantity, 0)
    }));
  }), [orders.data]);

  const filtered = rows.filter((row) => {
    if (tab === "all") return true;
    if (tab === "active") return ["pending", "quoted", "confirmed", "shipped"].includes(row.status);
    if (tab === "delivered") return row.status === "delivered";
    return row.status === "cancelled" || row.status === "rejected";
  });

  if (orders.isPending) return <View style={{ flex: 1 }}><OrderSheetSkeleton /></View>;
  if (orders.isError) return <ErrorState title={translate("ordersLoadError")} retryLabel={translate("retry")} busy={orders.isFetching} onRetry={() => void orders.refetch()} />;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: designTokens.spacing.md, paddingBottom: designTokens.spacing.xl }}>
      <SegmentedControl
        accessibilityLabel={translate("ordersTitle")}
        value={tab}
        onChange={(value) => { if (value === "all" || value === "active" || value === "delivered" || value === "cancelled") setTab(value); }}
        options={[
          { key: "all", label: translate("ordersTabAll") },
          { key: "active", label: translate("ordersTabActive") },
          { key: "delivered", label: translate("ordersTabDelivered") },
          { key: "cancelled", label: translate("ordersTabCancelled") }
        ]}
      />
      {filtered.length === 0 ? <EmptyState icon="package" title={tab === "all" ? translate("ordersEmpty") : translate("ordersEmptyTab")} hint={translate("ordersEmptyHint")} /> : null}
      {filtered.map((row) => {
        const code = formatOrderCode(row.order.id);
        const total = row.status === "cancelled" || row.status === "rejected" ? 0 : row.subtotal + row.shippingFee;
        const tone = getOrderStatusTone(row.status);
        return (
          <OrderCard
            key={row.key}
            accessibilityLabel={`${translate("ordersCode")} ${code}, ${orderStatusLabel(row.status)}`}
            onPress={() => {
              void queryClient.prefetchQuery({ queryKey: ["customer-order-details", row.order.id], queryFn: ({ signal }) => fetchCustomerOrderDetails(row.order.id, signal), staleTime: 15_000 });
              onNavigate();
              router.push({ pathname: "/orders/[orderId]", params: { orderId: row.order.id } });
            }}
            style={{ borderRadius: theme.radius.lg }}
            contentStyle={{ padding: designTokens.spacing.md, gap: designTokens.spacing.sm }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: designTokens.spacing.sm }}>
              <View style={{ flex: 1, gap: 3 }}>
                <UiText weight="800">{translate("ordersCode")}: {code}</UiText>
                {row.storeName ? <Caption>{row.storeName}</Caption> : null}
              </View>
              <OrderStatusBadge label={orderStatusLabel(row.status)} tone={tone === "success" ? "success" : tone === "danger" ? "danger" : tone === "pending" ? "warning" : "neutral"} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Caption>{formatNumber(row.itemCount)} {translate("ordersItems")}</Caption>
              <PriceDisplay value={formatMarketPrice(total, row.order.currency_code)} />
            </View>
          </OrderCard>
        );
      })}
    </ScrollView>
  );
}

function OrderSheetSkeleton() {
  return <View style={{ gap: designTokens.spacing.md }}>
    {[0, 1, 2].map((item) => <View key={item} style={{ height: 112, borderRadius: designTokens.radius.lg, backgroundColor: "rgba(128,128,128,0.12)" }} />)}
  </View>;
}

function FavoritesContent({ onNavigate }: { onNavigate: () => void }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<FavoriteKind>("products");
  const currency = useQuery({ queryKey: BROWSING_CURRENCY_QUERY_KEY, queryFn: ({ signal }) => fetchBrowsingCurrencyCode(signal), staleTime: 60_000 });
  const favorites = useQuery({ queryKey: FAVORITES_QUERY_KEY, queryFn: getFavorites });
  const content = useQuery({
    queryKey: ["customer-favorites-content", tab, tab === "products" ? favorites.data?.products : favorites.data?.stores],
    enabled: Boolean(favorites.data),
    staleTime: 30_000,
    queryFn: async () => {
      const ids = favorites.data;
      if (!ids) return { products: [], stores: [] };
      if (tab === "products") {
        const results = await Promise.all(ids.products.map(async (id) => {
          const offers = await queryClient.fetchQuery({ queryKey: ["customer-product-offers", id], queryFn: ({ signal }) => fetchProductOffers(id, signal), staleTime: 30_000 });
          const best = chooseBestProductOffer(offers);
          return best ? { id, offer: best } : null;
        }));
        return { products: results.flatMap((item) => item ? [item] : []), stores: [] };
      }
      const results = await Promise.all(ids.stores.map(async (id) => ({
        id,
        store: await queryClient.fetchQuery({ queryKey: ["customer-store", id], queryFn: ({ signal }) => fetchStoreDetails(id, signal), staleTime: 60_000 })
      })));
      return { products: [], stores: results.flatMap((item) => item.store ? [item] : []) };
    }
  });

  if (favorites.isPending) return <View style={{ flex: 1 }}><OrderSheetSkeleton /></View>;
  if (favorites.isError) return <ErrorState title={translate("catalogLoadError")} retryLabel={translate("retry")} busy={favorites.isFetching} onRetry={() => void favorites.refetch()} />;

  const productCount = favorites.data.products.length;
  const storeCount = favorites.data.stores.length;
  const visibleCount = content.data ? (tab === "products" ? content.data.products.length : content.data.stores.length) : (tab === "products" ? productCount : storeCount);

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: designTokens.spacing.md, paddingBottom: designTokens.spacing.xl }}>
      <SegmentedControl
        accessibilityLabel={translate("favoritesTitle")}
        value={tab}
        onChange={(value) => { if (value === "products" || value === "stores") setTab(value); }}
        options={[
          { key: "products", label: `${translate("favoriteProducts")} (${productCount})` },
          { key: "stores", label: `${translate("favoriteStores")} (${storeCount})` }
        ]}
      />
      {content.isPending ? <OrderSheetSkeleton /> : content.isError ? (
        <ErrorState title={translate("catalogLoadError")} retryLabel={translate("retry")} busy={content.isFetching} onRetry={() => void content.refetch()} />
      ) : visibleCount === 0 ? (
        <EmptyState icon="heart" title={translate(tab === "products" ? "favoriteProductsEmpty" : "favoriteStoresEmpty")} hint={translate("favoritesEmptyHint")} />
      ) : tab === "products" ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: designTokens.spacing.md }}>
          {content.data.products.map(({ id, offer }) => (
            <View key={id} style={{ width: "48%" }}>
              <ProductTile
                name={offer.product.name}
                store={offer.store.name}
                price={currency.data ? formatMarketPrice(offer.price, currency.data) : "—"}
                imageUrl={getPrimaryImage(offer)}
                action={<FavoriteToggle kind="products" id={id} />}
                onPress={() => {
                  void queryClient.prefetchQuery({ queryKey: ["customer-product", id], queryFn: ({ signal }) => fetchProductDetails(id, signal), staleTime: 60_000 });
                  void queryClient.prefetchQuery({ queryKey: ["customer-product-offers", id], queryFn: () => fetchProductOffers(id), staleTime: 30_000 });
                  onNavigate();
                  router.push({ pathname: "/product/[productId]", params: { productId: id } });
                }}
              />
            </View>
          ))}
        </View>
      ) : (
        <View style={{ gap: designTokens.spacing.md }}>
          {content.data.stores.map(({ id, store }) => (
            <StoreCard
              key={id}
              accessibilityLabel={store.name}
              onPress={() => {
                void queryClient.prefetchQuery({ queryKey: ["customer-store", id], queryFn: () => fetchStoreDetails(id), staleTime: 60_000 });
                void queryClient.prefetchQuery({ queryKey: ["customer-store-offers", id], queryFn: ({ signal }) => fetchStoreOffers(id, signal), staleTime: 30_000 });
                onNavigate();
                router.push({ pathname: "/store/[storeId]", params: { storeId: id } });
              }}
              contentStyle={{ flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md, padding: designTokens.spacing.md }}
              media={<Image uri={store.logo_url ?? undefined} accessibilityLabel={store.name} aspectRatio={1} style={{ width: 64, borderRadius: designTokens.radius.md }} />}
              actions={<FavoriteToggle kind="stores" id={id} />}
            >
              <View style={{ flex: 1, gap: designTokens.spacing.xs }}>
                <Heading level={3}>{store.name}</Heading>
                {store.commune ? <Caption>{store.commune}</Caption> : null}
                {store.description ? <Caption>{store.description}</Caption> : null}
                {store.rating != null ? <RatingStars value={store.rating} size={14} showValue /> : null}
              </View>
            </StoreCard>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function ReviewsContent({ onNavigate }: { onNavigate: () => void }) {
  const { language } = useLanguage();
  const reviews = useQuery({ queryKey: ["my-reviews"], queryFn: ({ signal }) => fetchMyReviews(signal), retry: false });
  if (reviews.isPending) return <View style={{ flex: 1 }}><OrderSheetSkeleton /></View>;
  if (reviews.isError) return <ErrorState title={translate("myReviewsLoadError")} retryLabel={translate("retry")} busy={reviews.isFetching} onRetry={() => void reviews.refetch()} />;
  if (reviews.data.length === 0) return <EmptyState icon="star" title={translate("myReviewsEmpty")} hint={translate("myReviewsEmptyHint")} />;

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: designTokens.spacing.md, paddingBottom: designTokens.spacing.xl }}>
      {reviews.data.map((review) => <ReviewItem key={review.id} review={review} language={language} onNavigate={onNavigate} />)}
    </ScrollView>
  );
}

function ReviewItem({ review, language, onNavigate }: { review: AppReview; language: Language; onNavigate: () => void }) {
  const date = new Date(review.created_at);
  const dateLabel = Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(language === "ar" ? "ar-DZ" : "en-DZ", { dateStyle: "medium" }).format(date);
  const target = review.target_type === "product" ? translate("myReviewsProduct") : translate("myReviewsStore");
  const status = review.status === "approved" ? translate("myReviewsApproved") : review.status === "rejected" ? translate("myReviewsRejected") : translate("myReviewsPending");
  return (
    <Card
      onPress={() => { onNavigate(); router.push(getReviewTargetPath(review) as never); }}
      accessibilityLabel={target}
      contentStyle={{ gap: designTokens.spacing.sm, padding: designTokens.spacing.md }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: designTokens.spacing.sm }}>
        <UiText weight="700">{target}</UiText>
        <RatingStars value={review.rating} size={15} showValue />
      </View>
      {review.comment ? <UiText>{review.comment}</UiText> : null}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(128,128,128,0.25)", paddingTop: designTokens.spacing.sm }}>
        <StatusBadge label={status} tone={review.status === "rejected" ? "danger" : review.status === "approved" ? "success" : "warning"} />
        <Caption>{dateLabel}</Caption>
      </View>
    </Card>
  );
}
