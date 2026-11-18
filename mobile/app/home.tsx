import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { FavoriteButton } from "@/components/favorite-button";
import { CustomerMainHeader } from "@/components/customer-main-header";
import {
  CustomerScreen,
  EmptyState,
  ErrorState,
  SectionTitle
} from "@/components/customer-ui";
import { BottomSheet, Caption, Icon, Image as UiImage, PriceDisplay, RatingStars, Text as UiText, ProductCardSkeleton } from "@/components/ui";
import { fetchHomeProducts, formatMarketPrice, getPrimaryImage, type HomeProduct } from "@/lib/catalog";
import { fetchBrowsingCurrencyCode } from "@/lib/country-service";
import { fetchApprovedReviews } from "@/lib/reviews";
import { translate } from "@/lib/i18n";
import { designTokens, useAppTheme } from "@/lib/theme";

function HomeProductCard({ item, width, price, onShowMore }: {
  item: HomeProduct;
  width: number;
  price: string;
  onShowMore: (item: HomeProduct) => void;
}) {
  const theme = useAppTheme();
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const reviews = useQuery({
    queryKey: ["approved-reviews", "product", item.product.id],
    queryFn: () => fetchApprovedReviews("product", item.product.id),
    staleTime: 60_000
  });
  const reviewCount = reviews.data?.length ?? 0;
  const reviewAverage = reviewCount > 0
    ? reviews.data!.reduce((total, review) => total + review.rating, 0) / reviewCount
    : 0;
  const images = [...item.images]
    .filter((image): image is typeof image & { image_url: string } => typeof image.image_url === "string" && image.image_url.trim().length > 0)
    .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)));
  const imageUrl = images[selectedImageIndex]?.image_url ?? getPrimaryImage(item);

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
        {imageUrl ? (
          <UiImage uri={imageUrl} accessibilityLabel={item.product.name} aspectRatio={1} style={StyleSheet.absoluteFill} />
        ) : (
          <Icon name="image" size={42} color={theme.colors.subtle} accessibilityHidden />
        )}

        <View style={styles.imageOverlayHeader}>
          <View style={styles.storeBadge}>
            <UiText numberOfLines={1} style={styles.storeBadgeText}>{item.store.name}</UiText>
          </View>
          <View style={[styles.storeLogo, { backgroundColor: theme.colors.surface }]}>
            {item.store.logo_url ? (
              <UiImage uri={item.store.logo_url} accessibilityLabel={item.store.name} aspectRatio={1} style={styles.storeLogoImage} />
            ) : (
              <Icon name="store" size={22} color={theme.colors.muted} accessibilityHidden />
            )}
          </View>
        </View>

        {images.length > 1 ? (
          <View style={styles.imagePagination}>
            {images.map((image, index) => (
              <Pressable
                key={image.id ?? image.image_url}
                accessibilityRole="button"
                accessibilityLabel={`${item.product.name} ${index + 1}`}
                accessibilityState={{ selected: selectedImageIndex === index }}
                onPress={() => setSelectedImageIndex(index)}
                hitSlop={7}
                style={[
                  styles.imageDot,
                  { backgroundColor: selectedImageIndex === index ? "#FFFFFF" : "rgba(255,255,255,0.55)" },
                  selectedImageIndex === index ? styles.imageDotActive : undefined
                ]}
              />
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.productInfo}>
        <UiText numberOfLines={2} weight="700" style={styles.productName}>{item.product.name}</UiText>
        <View style={styles.ratingRow}>
          <RatingStars value={reviewAverage} size={15} showValue />
          <Caption>{reviewCount} · {translate("reviewsTitle")}</Caption>
        </View>
        {item.product.description?.trim() ? (
          <UiText numberOfLines={2} tone="muted" style={styles.productDescription}>{item.product.description.trim()}</UiText>
        ) : null}
      </View>

      <View style={styles.productFooter}>
        <View style={[styles.pricePill, { backgroundColor: theme.colors.surfaceMuted }]}>
          <PriceDisplay value={price} />
        </View>
        <FavoriteButton kind="products" id={item.product.id} iconOnly />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={translate("homeShowMore")}
          onPress={() => onShowMore(item)}
          style={({ pressed }) => [
            styles.moreButton,
            { backgroundColor: theme.colors.foreground, opacity: pressed ? 0.82 : 1 }
          ]}
        >
          <UiText style={[styles.moreButtonText, { color: theme.colors.surface }]}>{translate("homeShowMore")}</UiText>
          <View style={[styles.moreButtonIcon, { backgroundColor: theme.colors.surface }]}>
            <Icon name="arrow-up-right" size={16} color={theme.colors.foreground} accessibilityHidden />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

export default function CustomerHomeScreen() {
  const theme = useAppTheme();
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = screenWidth - designTokens.spacing.xl * 2;
  const [selectedProduct, setSelectedProduct] = useState<HomeProduct | null>(null);
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
            <ProductCardSkeleton style={{ width: cardWidth, flex: 0, minHeight: 480 }} />
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
            snapToInterval={cardWidth}
            snapToAlignment="start"
            disableIntervalMomentum
          >
            {products.data.map((item) => (
              <HomeProductCard
                key={item.id}
                item={item}
                width={cardWidth}
                price={browsingCurrency.data ? formatMarketPrice(item.price, browsingCurrency.data) : "—"}
                onShowMore={setSelectedProduct}
              />
            ))}
          </ScrollView>
        )}
      </View>

      <BottomSheet
        visible={selectedProduct !== null}
        onRequestClose={() => setSelectedProduct(null)}
        title={translate("detailProductTitle")}
        maxHeight="78%"
      >
        {selectedProduct ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.detailsContent}>
            <View style={[styles.detailsImage, { backgroundColor: theme.colors.surfaceMuted }]}>
              {getPrimaryImage(selectedProduct) ? (
                <UiImage uri={getPrimaryImage(selectedProduct)!} accessibilityLabel={selectedProduct.product.name} aspectRatio={1} style={StyleSheet.absoluteFill} />
              ) : (
                <Icon name="image" size={36} color={theme.colors.subtle} accessibilityHidden />
              )}
            </View>
            <UiText weight="700" style={styles.detailsName}>{selectedProduct.product.name}</UiText>
            <PriceDisplay value={browsingCurrency.data ? formatMarketPrice(selectedProduct.price, browsingCurrency.data) : "—"} />
            {selectedProduct.product.description?.trim() ? (
              <UiText tone="muted" style={styles.detailsDescription}>{selectedProduct.product.description.trim()}</UiText>
            ) : null}
            <View style={styles.detailsStore}>
              <View style={styles.detailsStoreLogo}>
                {selectedProduct.store.logo_url ? (
                  <UiImage uri={selectedProduct.store.logo_url} accessibilityLabel={selectedProduct.store.name} aspectRatio={1} style={styles.detailsStoreLogoImage} />
                ) : (
                  <Icon name="store" size={20} color="#888888" accessibilityHidden />
                )}
              </View>
              <UiText weight="700">{selectedProduct.store.name}</UiText>
            </View>
            <FavoriteButton kind="products" id={selectedProduct.product.id} />
          </ScrollView>
        ) : null}
      </BottomSheet>
    </CustomerScreen>
  );
}


const styles = StyleSheet.create({
  productRail: {
    flexDirection: "row",
    gap: 0,
    paddingEnd: 0
  },
  productCard: {
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    padding: designTokens.spacing.sm,
    gap: designTokens.spacing.md,
    overflow: "hidden"
  },
  productImage: {
    height: 320,
    borderRadius: 24,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center"
  },
  imageOverlayHeader: {
    position: "absolute",
    top: designTokens.spacing.md,
    left: designTokens.spacing.md,
    right: designTokens.spacing.md,
    height: 50
  },
  storeBadge: {
    position: "absolute",
    top: 0,
    left: 0,
    maxWidth: "72%",
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: designTokens.spacing.md,
    borderRadius: designTokens.radius.pill,
    backgroundColor: "rgba(0,0,0,0.68)"
  },
  storeBadgeText: {
    color: "#FFFFFF",
    fontSize: designTokens.typography.caption,
    fontWeight: "700"
  },
  storeLogo: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden"
  },
  storeLogoImage: {
    width: 46,
    height: 46,
    borderRadius: 23
  },
  imagePagination: {
    position: "absolute",
    bottom: designTokens.spacing.md,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 7
  },
  imageDot: {
    width: 7,
    height: 7,
    borderRadius: 4
  },
  imageDotActive: {
    width: 20,
    borderRadius: 5
  },
  productInfo: {
    gap: designTokens.spacing.xs,
    paddingHorizontal: designTokens.spacing.xs
  },
  productName: {
    fontSize: 24,
    lineHeight: 30,
    textAlign: "auto"
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: designTokens.spacing.sm
  },
  productDescription: {
    fontSize: designTokens.typography.body - 1,
    lineHeight: 22,
    textAlign: "auto"
  },
  productFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: designTokens.spacing.sm,
    paddingHorizontal: designTokens.spacing.xs,
    paddingBottom: designTokens.spacing.xs
  },
  pricePill: {
    minHeight: 48,
    paddingHorizontal: designTokens.spacing.md,
    borderRadius: designTokens.radius.pill,
    alignItems: "center",
    justifyContent: "center"
  },
  moreButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: designTokens.radius.pill,
    paddingStart: designTokens.spacing.lg,
    paddingEnd: designTokens.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  moreButtonText: {
    fontSize: designTokens.typography.body,
    fontWeight: "700"
  },
  moreButtonIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center"
  },
  detailsContent: {
    gap: designTokens.spacing.md,
    paddingBottom: designTokens.spacing.xl
  },
  detailsImage: {
    height: 190,
    borderRadius: designTokens.radius.lg,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center"
  },
  detailsName: {
    fontSize: designTokens.typography.subtitle,
    textAlign: "auto"
  },
  detailsDescription: {
    fontSize: designTokens.typography.body,
    lineHeight: 23,
    textAlign: "auto"
  },
  detailsStore: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: designTokens.spacing.md,
    paddingVertical: designTokens.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(127,127,127,0.22)"
  },
  detailsStoreLogo: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent"
  },
  detailsStoreLogoImage: {
    width: 44,
    height: 44,
    borderRadius: 22
  }
});
