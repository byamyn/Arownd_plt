import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { LayoutChangeEvent, StyleSheet, View } from "react-native";

import { FavoriteButton } from "@/components/favorite-button";
import { CustomerMainHeader } from "@/components/customer-main-header";
import {
  CustomerScreen,
  EmptyState,
  ErrorState,
} from "@/components/customer-ui";
import { Button, Caption, Icon, Image as UiImage, PriceDisplay, RatingStars, Text as UiText, ProductCardSkeleton } from "@/components/ui";
import { fetchHomeProducts, fetchProductDetails, fetchProductOffers, formatMarketPrice, getPrimaryImage } from "@/lib/catalog";
import { fetchBrowsingCurrencyCode } from "@/lib/country-service";
import { fetchApprovedReviews } from "@/lib/reviews";
import { translate } from "@/lib/i18n";
import { designTokens, useAppTheme } from "@/lib/theme";

function HomeProductCard({ item, price }: {
  item: Awaited<ReturnType<typeof fetchHomeProducts>>[number];
  price: string;
}) {
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const reviews = useQuery({
    queryKey: ["approved-reviews", "product", item.product.id],
    queryFn: () => fetchApprovedReviews("product", item.product.id),
    staleTime: 60_000
  });
  const reviewCount = reviews.data?.length ?? 0;
  const reviewAverage = reviewCount > 0
    ? reviews.data!.reduce((total, review) => total + review.rating, 0) / reviewCount
    : 0;

  const openDetails = () => {
    void queryClient.prefetchQuery({
      queryKey: ["customer-product", item.product.id],
      queryFn: () => fetchProductDetails(item.product.id),
      staleTime: 60_000
    });
    void queryClient.prefetchQuery({
      queryKey: ["customer-product-offers", item.product.id],
      queryFn: () => fetchProductOffers(item.product.id),
      staleTime: 30_000
    });
    void queryClient.prefetchQuery({
      queryKey: ["approved-reviews", "product", item.product.id],
      queryFn: () => fetchApprovedReviews("product", item.product.id),
      staleTime: 60_000
    });
    router.push({ pathname: "/product/[productId]", params: { productId: item.product.id } });
  };

  return (
    <View style={[
      styles.productCard,
      {
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border
      }
    ]}>
      <View style={[styles.productImage, { backgroundColor: theme.colors.surfaceMuted }]}>
        {getPrimaryImage(item) ? (
          <UiImage uri={getPrimaryImage(item)!} accessibilityLabel={item.product.name} aspectRatio={1} style={StyleSheet.absoluteFill} />
        ) : (
          <Icon name="image" size={42} color={theme.colors.subtle} accessibilityHidden />
        )}
        <View style={styles.favoriteButton}>
          <FavoriteButton kind="products" id={item.product.id} iconOnly />
        </View>
      </View>

      <View style={styles.productInfo}>
        <UiText numberOfLines={2} weight="700" style={styles.productName}>{item.product.name}</UiText>
        <View style={styles.storeMeta}>
          <View style={styles.storeName}>
            <Icon name="store" size={14} color={theme.colors.muted} accessibilityHidden />
            <Caption numberOfLines={1}>{item.store.name}</Caption>
          </View>
          <View style={[styles.availability, { backgroundColor: theme.colors.surfaceMuted }]}>
            <Caption style={{ color: theme.colors.foreground }}>{translate("homeProductAvailable")}</Caption>
          </View>
        </View>
        <View style={styles.productMeta}>
          <PriceDisplay value={price} />
          <View style={styles.rating}>
            <RatingStars value={reviewAverage} size={15} showValue />
            <Caption>{reviewCount}</Caption>
          </View>
        </View>
        <Button
          label={translate("homeBuyNow")}
          onPress={openDetails}
          fullWidth
          size="lg"
          style={styles.buyNowButton}
        />
      </View>
    </View>
  );
}

export default function CustomerHomeScreen() {
  const [feedHeight, setFeedHeight] = useState(0);
  const browsingCurrency = useQuery({ queryKey: ["browsing-country-currency"], queryFn: fetchBrowsingCurrencyCode, staleTime: 60_000 });
  const products = useQuery({ queryKey: ["customer-home-products"], queryFn: fetchHomeProducts, staleTime: 60_000 });
  const handleFeedLayout = (event: LayoutChangeEvent) => {
    const nextHeight = Math.round(event.nativeEvent.layout.height);
    setFeedHeight((current) => current === nextHeight ? current : nextHeight);
  };

  return (
    <CustomerScreen
      header={<CustomerMainHeader />}
      contentStyle={styles.feedContent}
      scrollViewProps={{ pagingEnabled: true, decelerationRate: "fast", onLayout: handleFeedLayout }}
      refreshing={products.isFetching}
      onRefresh={() => { void products.refetch(); }}
    >
      {products.isPending ? (
        <View style={[styles.feedPage, { height: feedHeight || 560 }]}>
          <ProductCardSkeleton style={{ flex: 1 }} />
        </View>
      ) : products.isError ? (
        <View style={[styles.feedState, { minHeight: feedHeight || 560 }]}>
          <ErrorState title={translate("catalogLoadError")} retryLabel={translate("retry")} busy={products.isFetching} onRetry={() => void products.refetch()} />
        </View>
      ) : products.data.length === 0 ? (
        <View style={[styles.feedState, { minHeight: feedHeight || 560 }]}>
          <EmptyState icon="package" title={translate("homeNoProducts")} hint={translate("homeNoProductsHint")} />
        </View>
      ) : (
        products.data.map((item) => (
          <View key={item.id} style={[styles.feedPage, { height: feedHeight || 560 }]}>
            <HomeProductCard
              item={item}
              price={browsingCurrency.data ? formatMarketPrice(item.price, browsingCurrency.data) : "—"}
            />
          </View>
        ))
      )}
    </CustomerScreen>
  );
}

const styles = StyleSheet.create({
  feedContent: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0, gap: 0 },
  feedPage: { width: "100%", paddingHorizontal: designTokens.spacing.xl, paddingVertical: designTokens.spacing.md },
  feedState: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: designTokens.spacing.xl },
  productCard: { flex: 1, width: "100%", borderRadius: designTokens.radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: designTokens.spacing.sm, gap: designTokens.spacing.md, overflow: "hidden" },
  productImage: { flex: 6.5, minHeight: 0, borderRadius: designTokens.radius.lg, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  favoriteButton: { position: "absolute", top: designTokens.spacing.sm, end: designTokens.spacing.sm },
  productInfo: { flex: 3.5, minHeight: 0, justifyContent: "space-between", gap: designTokens.spacing.xs, paddingHorizontal: designTokens.spacing.xs, paddingBottom: designTokens.spacing.xs },
  productName: { minHeight: 40, lineHeight: 22, textAlign: "auto" },
  storeMeta: { minHeight: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: designTokens.spacing.sm },
  storeName: { flex: 1, flexDirection: "row", alignItems: "center", gap: designTokens.spacing.xs },
  availability: { paddingHorizontal: designTokens.spacing.sm, paddingVertical: designTokens.spacing.xs, borderRadius: designTokens.radius.pill },
  productMeta: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: designTokens.spacing.sm },
  rating: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.xs },
  buyNowButton: { borderRadius: designTokens.radius.md }
});
