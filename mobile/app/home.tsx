import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from "react-native";

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
import { registerHomeReselectHandler } from "@/lib/customer-navigation-state";
import { designTokens, useAppTheme } from "@/lib/theme";

function HomeProductCard({ item, price }: {
  item: Awaited<ReturnType<typeof fetchHomeProducts>>[number];
  price: string;
}) {
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const lastImageTapAt = useRef(0);
  const imagePagerRef = useRef<ScrollViewInstance>(null);
  const [imageWidth, setImageWidth] = useState(0);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const imageScale = useRef(new Animated.Value(1)).current;
  const currentImageScale = useRef(1);
  const pinchStartDistance = useRef(0);
  const pinchStartScale = useRef(1);
  const heartOpacity = useRef(new Animated.Value(0)).current;
  const heartScale = useRef(new Animated.Value(0.35)).current;
  const productFavorite = useFavoriteToggle("products", item.product.id);
  const productReviews = useQuery({
    queryKey: ["approved-reviews", "product", item.product.id],
    queryFn: () => fetchApprovedReviews("product", item.product.id),
    staleTime: 60_000
  });
  const primaryImage = getPrimaryImage(item);
  const productImages = [...new Set([primaryImage, ...item.images.map((image) => image.image_url)].filter((uri): uri is string => Boolean(uri)))];
  const reviewCount = productReviews.data?.length ?? 0;
  const averageRating = reviewCount > 0
    ? productReviews.data!.reduce((total, review) => total + review.rating, 0) / reviewCount
    : null;
  const handleImageScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (imageWidth <= 0) return;
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / imageWidth);
    setActiveImageIndex(Math.max(0, Math.min(nextIndex, productImages.length - 1)));
  };
  const showDoubleTapHeart = () => {
    heartOpacity.stopAnimation();
    heartScale.stopAnimation();
    heartOpacity.setValue(0);
    heartScale.setValue(0.35);
    Animated.parallel([
      Animated.timing(heartOpacity, { toValue: 1, duration: 90, useNativeDriver: true }),
      Animated.spring(heartScale, { toValue: 1, friction: 5, tension: 110, useNativeDriver: true })
    ]).start(() => {
      Animated.sequence([
        Animated.delay(280),
        Animated.parallel([
          Animated.timing(heartOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
          Animated.timing(heartScale, { toValue: 0.82, duration: 220, useNativeDriver: true })
        ])
      ]).start();
    });
  };
  const handleImageTap = () => {
    const now = Date.now();
    if (now - lastImageTapAt.current <= 300 && !productFavorite.disabled) {
      if (!productFavorite.active) productFavorite.toggle();
      showDoubleTapHeart();
      lastImageTapAt.current = 0;
      return;
    }
    lastImageTapAt.current = now;
  };
  const pinchResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: (event) => event.nativeEvent.touches.length >= 2,
    onMoveShouldSetPanResponderCapture: (event) => event.nativeEvent.touches.length >= 2,
    onPanResponderGrant: (event) => {
      const [first, second] = event.nativeEvent.touches;
      if (!first || !second) return;
      pinchStartDistance.current = Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY);
      pinchStartScale.current = currentImageScale.current;
    },
    onPanResponderMove: (event) => {
      const [first, second] = event.nativeEvent.touches;
      if (!first || !second || pinchStartDistance.current <= 0) return;
      const distance = Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY);
      const nextScale = Math.max(1, Math.min(3, pinchStartScale.current * distance / pinchStartDistance.current));
      currentImageScale.current = nextScale;
      imageScale.setValue(nextScale);
    },
    onPanResponderRelease: () => {
      pinchStartDistance.current = 0;
    },
    onPanResponderTerminate: () => {
      pinchStartDistance.current = 0;
    },
    onPanResponderTerminationRequest: () => false
  }), [imageScale]);
  const selectImage = (index: number) => {
    if (imageWidth > 0) imagePagerRef.current?.scrollTo({ x: index * imageWidth, animated: true });
    setActiveImageIndex(index);
  };

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
      <View
        {...pinchResponder.panHandlers}
        style={[styles.productImage, { backgroundColor: theme.colors.surfaceMuted }]}
        onLayout={(event) => setImageWidth(event.nativeEvent.layout.width)}
      >
        {productImages.length > 0 ? (
          <ScrollView
            ref={imagePagerRef}
            horizontal
            pagingEnabled
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            style={StyleSheet.absoluteFill}
            onMomentumScrollEnd={handleImageScrollEnd}
          >
            {productImages.map((uri, index) => (
              <Pressable
                key={uri}
                onPress={handleImageTap}
                accessibilityRole="button"
                accessibilityLabel={`${item.product.name} — ${index + 1}`}
                accessibilityHint={translate("favoriteAdd")}
                style={{ width: imageWidth || "100%", height: "100%" }}
              >
                <Animated.View
                  style={{
                    width: "100%",
                    height: "100%",
                    transform: [{ scale: imageScale }]
                  }}
                >
                  <UiImage
                    uri={uri}
                    accessibilityLabel={item.product.name}
                    aspectRatio={1}
                    style={{ width: "100%", height: "100%", borderRadius: 0 }}
                  />
                </Animated.View>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <Icon name="image" size={42} color={theme.colors.subtle} accessibilityHidden />
        )}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.doubleTapHeartOverlay,
            { opacity: heartOpacity, transform: [{ scale: heartScale }] }
          ]}
        >
          <Icon name="heart" size={82} color="#F0646A" fill="#F0646A" accessibilityHidden />
        </Animated.View>
        {productImages.length > 1 ? (
          <View style={styles.imagePagination} accessibilityLabel={` ${activeImageIndex + 1} / ${productImages.length}`}>
            {productImages.map((uri, index) => (
              <Pressable
                key={uri}
                onPress={() => selectImage(index)}
                accessibilityRole="button"
                accessibilityLabel={`الصورة ${index + 1}`}
                accessibilityState={{ selected: activeImageIndex === index }}
                hitSlop={6}
                style={[
                  styles.imagePaginationDot,
                  activeImageIndex === index ? styles.imagePaginationDotActive : styles.imagePaginationDotInactive
                ]}
              />
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.productInfo}>
        <View style={styles.productInfoRows}>
          <View style={styles.productStoreRow}>
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
            {averageRating !== null ? (
              <View style={styles.storeRating}>
                <Icon name="star" size={14} color="#E5A000" fill="#E5A000" accessibilityHidden />
                <Caption>{averageRating.toFixed(1)} · {reviewCount} {translate("homeReviewCount")}</Caption>
              </View>
            ) : <View />}
          </View>

          <UiText numberOfLines={2} weight="700" style={styles.productName}>{item.product.name}</UiText>

          <View style={styles.productPurchaseRow}>
            <PriceDisplay value={price} />
            <View style={styles.productActionsRow}>
              <Button label={translate("homeBuyNow")} onPress={openDetails} size="sm" style={styles.buyNowButton} />
              <FavoriteButton kind="products" id={item.product.id} iconOnly />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

export default function CustomerHomeScreen() {
  const [feedHeight, setFeedHeight] = useState(0);
  const feedScrollRef = useRef<ScrollViewInstance>(null);
  const queryClient = useQueryClient();
  const browsingCurrency = useQuery({ queryKey: ["browsing-country-currency"], queryFn: fetchBrowsingCurrencyCode, staleTime: 60_000 });
  const products = useQuery({ queryKey: ["customer-home-products"], queryFn: fetchHomeProducts, staleTime: 60_000 });
  useEffect(() => registerHomeReselectHandler(() => {
    feedScrollRef.current?.scrollTo({ y: 0, animated: true });
    void queryClient.invalidateQueries({ queryKey: ["customer-home-products"], exact: true });
    void queryClient.invalidateQueries({ queryKey: ["browsing-country-currency"], exact: true });
    void queryClient.invalidateQueries({ queryKey: ["approved-reviews", "product"] });
  }), [queryClient]);

  const handleFeedLayout = (event: LayoutChangeEvent) => {
    const nextHeight = Math.round(event.nativeEvent.layout.height);
    setFeedHeight((current) => current === nextHeight ? current : nextHeight);
  };

  return (
    <CustomerScreen
      header={<CustomerMainHeader />}
      contentStyle={styles.feedContent}
      scrollRef={feedScrollRef}
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
  feedPage: { width: "100%", paddingHorizontal: 0, paddingVertical: 0 },
  feedState: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: designTokens.spacing.xl },
  productCard: { flex: 1, width: "100%", borderRadius: 0, overflow: "hidden" },
  productImage: { flex: 3, minHeight: 0, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  doubleTapHeartOverlay: { position: "absolute", top: "38%", left: 0, right: 0, alignItems: "center", justifyContent: "center" },
  imagePagination: { position: "absolute", bottom: designTokens.spacing.md, alignSelf: "center", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  imagePaginationDot: { width: 6, height: 6, borderRadius: 3 },
  imagePaginationDotActive: { width: 16, backgroundColor: "#FFFFFF", opacity: 1 },
  imagePaginationDotInactive: { backgroundColor: "#888888", opacity: 0.65 },
  productInfo: { flex: 1, minHeight: 0, backgroundColor: "transparent", justifyContent: "center", paddingHorizontal: designTokens.spacing.md, paddingVertical: designTokens.spacing.sm },
  productInfoRows: { flex: 1, minHeight: 0, justifyContent: "space-between", gap: designTokens.spacing.sm },
  productStoreRow: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: designTokens.spacing.sm },
  productPurchaseRow: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: designTokens.spacing.sm },
  productActionsRow: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.sm },
  productName: { lineHeight: 21, textAlign: "auto", alignSelf: "stretch" },
  storeIdentity: { flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: designTokens.spacing.xs, flexShrink: 1, minWidth: 0 },
  storeTitle: { flexShrink: 1, fontSize: 13, textAlign: "auto" },
  storeAvatar: { width: 36, height: 36, borderRadius: 18, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  storeAvatarImage: { width: 36, height: 36, borderRadius: 18 },
  storeRating: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 },
  buyNowButton: { minHeight: 44, minWidth: 112, paddingHorizontal: designTokens.spacing.sm, borderRadius: designTokens.radius.lg }
});
