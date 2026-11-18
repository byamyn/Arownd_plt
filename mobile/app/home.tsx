import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { FavoriteButton } from "@/components/favorite-button";
import { CustomerMainHeader } from "@/components/customer-main-header";
import {
  CustomerScreen,
  EmptyState,
  ErrorState,
  SectionTitle
} from "@/components/customer-ui";
import { Button, Caption, Icon, Image as UiImage, PriceDisplay, RatingStars, Text as UiText, ProductCardSkeleton } from "@/components/ui";
import { fetchHomeProducts, fetchProductDetails, fetchProductOffers, formatMarketPrice, getPrimaryImage } from "@/lib/catalog";
import { fetchBrowsingCurrencyCode } from "@/lib/country-service";
import { fetchApprovedReviews } from "@/lib/reviews";
import { translate } from "@/lib/i18n";
import { designTokens, useAppTheme } from "@/lib/theme";

function HomeProductCard({ item, width, price }: {
  item: Awaited<ReturnType<typeof fetchHomeProducts>>[number];
  width: number;
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
        width,
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
        <View style={styles.productMeta}>
          <PriceDisplay value={price} />
          <View style={styles.rating}>
            <RatingStars value={reviewAverage} size={15} showValue />
            <Caption>{reviewCount}</Caption>
          </View>
        </View>
        <Button
          label={translate("homeShowMore")}
          onPress={openDetails}
          fullWidth
          size="lg"
          style={styles.moreButton}
        />
      </View>
    </View>
  );
}

export default function CustomerHomeScreen() {
  const theme = useAppTheme();
  const { width: screenWidth } = useWindowDimensions();
  const queryClient = useQueryClient();
  const cardWidth = Math.max(240, screenWidth - 88);
  const browsingCurrency = useQuery({ queryKey: ["browsing-country-currency"], queryFn: fetchBrowsingCurrencyCode, staleTime: 60_000 });
  const products = useQuery({ queryKey: ["customer-home-products"], queryFn: fetchHomeProducts, staleTime: 60_000 });
  return (
    <CustomerScreen
      refreshing={products.isFetching}
      onRefresh={() => { void products.refetch(); }}
    >
      <CustomerMainHeader />

      <View>
        <SectionTitle title={translate("homeNewArrivals")} />
        {products.isPending ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.productRail}>
            {[0, 1].map((item) => <ProductCardSkeleton key={item} style={{ width: cardWidth, flex: 0, minHeight: 360 }} />)}
          </ScrollView>
        ) : products.isError ? (
          <ErrorState title={translate("catalogLoadError")} retryLabel={translate("retry")} busy={products.isFetching} onRetry={() => void products.refetch()} />
        ) : products.data.length === 0 ? (
          <EmptyState icon="package" title={translate("homeNoProducts")} hint={translate("homeNoProductsHint")} />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.productRail}
            decelerationRate="fast"
            snapToInterval={cardWidth + designTokens.spacing.md}
            snapToAlignment="start"
          >
            {products.data.map((item) => (
              <HomeProductCard
                key={item.id}
                item={item}
                width={cardWidth}
                price={browsingCurrency.data ? formatMarketPrice(item.price, browsingCurrency.data) : "—"}
              />
            ))}
          </ScrollView>
        )}
      </View>
    </CustomerScreen>
  );
}

const styles = StyleSheet.create({
  productRail: {
    flexDirection: "row",
    gap: designTokens.spacing.md,
    paddingEnd: designTokens.spacing.xl
  },
  productCard: {
    borderRadius: designTokens.radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: designTokens.spacing.sm,
    gap: designTokens.spacing.md,
    overflow: "hidden"
  },
  productImage: {
    height: 248,
    borderRadius: designTokens.radius.lg,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center"
  },
  favoriteButton: {
    position: "absolute",
    top: designTokens.spacing.sm,
    end: designTokens.spacing.sm
  },
  productInfo: {
    gap: designTokens.spacing.md,
    paddingHorizontal: designTokens.spacing.xs,
    paddingBottom: designTokens.spacing.xs
  },
  productName: {
    minHeight: 44,
    lineHeight: 22,
    textAlign: "auto"
  },
  productMeta: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: designTokens.spacing.sm
  },
  rating: {
    flexDirection: "row",
    alignItems: "center",
    gap: designTokens.spacing.xs
  },
  moreButton: {
    borderRadius: designTokens.radius.md
  }
});
