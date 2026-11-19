import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";

import { FavoriteButton, useFavoriteToggle } from "@/components/favorite-button";
import { CustomerMainHeader } from "@/components/customer-main-header";
import {
  CustomerScreen,
  EmptyState,
  ErrorState,
} from "@/components/customer-ui";
import { Button, Caption, Icon, Image as UiImage, PriceDisplay, Text as UiText, ProductCardSkeleton } from "@/components/ui";
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
  const [descriptionHasMore, setDescriptionHasMore] = useState(false);
  const lastImageTapAt = useRef(0);
  const productFavorite = useFavoriteToggle("products", item.product.id);

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
    <View style={[styles.productCard, { backgroundColor: theme.colors.surface }]}>
      <Pressable
        style={[styles.productImage, { backgroundColor: theme.colors.surfaceMuted }]}
        onPress={() => {
          const now = Date.now();
          if (now - lastImageTapAt.current <= 300 && !productFavorite.disabled) {
            productFavorite.toggle();
            lastImageTapAt.current = 0;
            return;
          }
          lastImageTapAt.current = now;
        }}
        accessibilityRole="button"
        accessibilityLabel={item.product.name}
        accessibilityHint={translate("favoriteAdd")}
      >
        {getPrimaryImage(item) ? (
          <UiImage uri={getPrimaryImage(item)!} accessibilityLabel={item.product.name} aspectRatio={1} style={StyleSheet.absoluteFill} />
        ) : (
          <Icon name="image" size={42} color={theme.colors.subtle} accessibilityHidden />
        )}
        <View style={styles.favoriteButton}>
          <FavoriteButton kind="products" id={item.product.id} iconOnly />
        </View>
      </Pressable>

      <View style={styles.productInfo}>
        <View style={styles.productInfoColumns}>
          <View style={styles.productDescriptionColumn}>
            <UiText numberOfLines={2} weight="700" style={styles.productName}>{item.product.name}</UiText>
            {item.product.description ? (
              <View style={styles.descriptionPreview}>
                <UiText
                  onTextLayout={(event) => {
                    const hasMore = event.nativeEvent.lines.length > 2;
                    setDescriptionHasMore((current) => current === hasMore ? current : hasMore);
                  }}
                  style={styles.productDescription}
                >
                  {item.product.description}
                </UiText>
              </View>
            ) : null}
            {descriptionHasMore ? (
              <Button label={translate("homeShowMore")} onPress={openDetails} variant="ghost" size="sm" style={styles.showMoreButton} />
            ) : null}
          </View>

          <View style={styles.storeColumn}>
            <Pressable
              style={styles.storeIdentity}
              onPress={() => router.push({ pathname: "/store/[storeId]", params: { storeId: item.store.id } })}
              accessibilityRole="button"
              accessibilityLabel={item.store.name}
            >
              <UiText numberOfLines={1} weight="600" style={styles.storeTitle}>{item.store.name}</UiText>
              <View style={[styles.storeAvatar, { backgroundColor: theme.colors.surfaceMuted }]}>
                {item.store.logo_url ? (
                  <UiImage uri={item.store.logo_url} accessibilityLabel={item.store.name} aspectRatio={1} style={styles.storeAvatarImage} />
                ) : (
                  <Icon name="store" size={19} color={theme.colors.muted} accessibilityHidden />
                )}
              </View>
            </Pressable>
            {item.store.rating != null ? (
              <View style={styles.storeRating}>
                <Icon name="star" size={14} color="#E5A000" fill="#E5A000" accessibilityHidden />
                <Caption>{item.store.rating.toFixed(1)}</Caption>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.priceRow}>
          <PriceDisplay value={price} />
          <Button label={translate("homeBuyNow")} onPress={openDetails} size="sm" />
        </View>
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
  productCard: { flex: 1, width: "100%", borderRadius: designTokens.radius.xl, overflow: "hidden" },
  productImage: { flex: 3, minHeight: 0, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  favoriteButton: { position: "absolute", top: designTokens.spacing.md, end: designTokens.spacing.md },
  productInfo: { flex: 1, minHeight: 0, backgroundColor: "transparent", justifyContent: "space-between", paddingHorizontal: designTokens.spacing.md, paddingVertical: designTokens.spacing.sm, gap: designTokens.spacing.xs },
  productInfoColumns: { flex: 1, minHeight: 0, flexDirection: "row", justifyContent: "space-between", gap: designTokens.spacing.md },
  productDescriptionColumn: { flex: 1, minWidth: 0, alignItems: "flex-start", gap: 3 },
  productName: { lineHeight: 21, textAlign: "auto" },
  descriptionPreview: { maxHeight: 36, overflow: "hidden", alignSelf: "stretch" },
  productDescription: { fontSize: 12, lineHeight: 18, textAlign: "auto" },
  showMoreButton: { minHeight: 22, paddingHorizontal: 0, paddingVertical: 0, alignSelf: "flex-start" },
  storeColumn: { flex: 1, minWidth: 0, alignItems: "flex-end", gap: designTokens.spacing.xs },
  storeIdentity: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: designTokens.spacing.xs, maxWidth: "100%" },
  storeTitle: { flexShrink: 1, fontSize: 13, textAlign: "auto" },
  storeAvatar: { width: 38, height: 38, borderRadius: 19, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  storeAvatarImage: { width: 38, height: 38, borderRadius: 19 },
  storeRating: { flexDirection: "row", alignItems: "center", gap: 4 },
  priceRow: { minHeight: 34, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: designTokens.spacing.sm }
});
