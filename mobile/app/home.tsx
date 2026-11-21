import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Animated, FlatList, PanResponder, Pressable, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FavoriteButton, useFavoriteToggle } from "@/components/favorite-button";
import { CustomerNavigation } from "@/components/customer-navigation";
import { CustomerMainHeader } from "@/components/customer-main-header";
import {
  EmptyState,
  ErrorState,
} from "@/components/customer-ui";
import { Button, Caption, Icon, Image as UiImage, PriceDisplay, Text as UiText, ProductFeedSkeleton } from "@/components/ui";
import { PullToRefresh } from "@/components/ui/pull-to-refresh";
import { fetchHomeProducts, fetchProductDetails, fetchProductOffers, formatMarketPrice, getPrimaryImage } from "@/lib/catalog";
import { BROWSING_CURRENCY_QUERY_KEY, fetchBrowsingCurrencyCode } from "@/lib/country-service";
import { fetchApprovedReviews } from "@/lib/reviews";
import { translate } from "@/lib/i18n";
import { registerHomeReselectHandler } from "@/lib/customer-navigation-state";
import { designTokens, useAppTheme } from "@/lib/theme";

const HomeProductCard = memo(function HomeProductCard({ item, price }: {
  item: Awaited<ReturnType<typeof fetchHomeProducts>>[number];
  price: string;
}) {
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const lastImageTapAt = useRef(0);
  const imagePagerRef = useRef<FlatList<string>>(null);
  const [imageWidth, setImageWidth] = useState(0);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const imageScale = useRef(new Animated.Value(1)).current;
  const currentImageScale = useRef(1);
  const pinchStartDistance = useRef(0);
  const pinchStartScale = useRef(1);
  const heartOpacity = useRef(new Animated.Value(0)).current;
  const heartScale = useRef(new Animated.Value(0.35)).current;
  const productFavorite = useFavoriteToggle("products", item.product.id);
  const primaryImage = getPrimaryImage(item);
  const productImages = useMemo(
    () => [...new Set([primaryImage, ...item.images.map((image) => image.image_url)].filter((uri): uri is string => Boolean(uri)))],
    [primaryImage, item.images]
  );
  const averageRating = item.product.rating != null && item.product.rating > 0 ? item.product.rating : null;
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
    if (imageWidth > 0) imagePagerRef.current?.scrollToOffset({ offset: index * imageWidth, animated: true });
    setActiveImageIndex(index);
  };

  const openDetails = () => {
    void queryClient.prefetchQuery({
      queryKey: ["customer-product", item.product.id],
      queryFn: ({ signal }) => fetchProductDetails(item.product.id, signal),
      staleTime: 60_000
    });
    void queryClient.prefetchQuery({
      queryKey: ["customer-product-offers", item.product.id],
      queryFn: ({ signal }) => fetchProductOffers(item.product.id, signal),
      staleTime: 30_000
    });
    void queryClient.prefetchQuery({
      queryKey: ["approved-reviews", "product", item.product.id],
      queryFn: ({ signal }) => fetchApprovedReviews("product", item.product.id, signal),
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
          <FlatList
            ref={imagePagerRef}
            data={productImages}
            horizontal
            pagingEnabled
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            style={StyleSheet.absoluteFill}
            keyExtractor={(uri) => uri}
            initialNumToRender={1}
            maxToRenderPerBatch={1}
            windowSize={2}
            removeClippedSubviews
            getItemLayout={imageWidth > 0 ? (_data, index) => ({ length: imageWidth, offset: imageWidth * index, index }) : undefined}
            renderItem={({ item: uri, index }) => (
              <Pressable
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
            )}
            onMomentumScrollEnd={handleImageScrollEnd}
          />
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
                <Caption>{averageRating.toFixed(1)}</Caption>
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
});

export default function CustomerHomeScreen() {
  const [feedHeight, setFeedHeight] = useState(0);
  const feedListRef = useRef<FlatList<Awaited<ReturnType<typeof fetchHomeProducts>>[number]>>(null);
  const queryClient = useQueryClient();
  const theme = useAppTheme();
  const browsingCurrency = useQuery({ queryKey: BROWSING_CURRENCY_QUERY_KEY, queryFn: ({ signal }) => fetchBrowsingCurrencyCode(signal), staleTime: 60_000 });
  const products = useQuery({ queryKey: ["customer-home-products"], queryFn: ({ signal }) => fetchHomeProducts(signal), staleTime: 60_000 });

  useEffect(() => registerHomeReselectHandler(() => {
    feedListRef.current?.scrollToOffset({ offset: 0, animated: true });
    void queryClient.invalidateQueries({ queryKey: ["customer-home-products"], exact: true });
    void queryClient.invalidateQueries({ queryKey: BROWSING_CURRENCY_QUERY_KEY, exact: true });
    void queryClient.invalidateQueries({ queryKey: ["approved-reviews", "product"] });
  }), [queryClient]);

  const handleFeedLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.round(event.nativeEvent.layout.height);
    setFeedHeight((current) => current === nextHeight ? current : nextHeight);
  }, []);

  const renderProduct = useCallback(({ item }: { item: Awaited<ReturnType<typeof fetchHomeProducts>>[number] }) => (
    <View style={[styles.feedPage, { height: feedHeight || 560 }]}>
      <HomeProductCard
        item={item}
        price={browsingCurrency.data ? formatMarketPrice(item.price, browsingCurrency.data) : "—"}
      />
    </View>
  ), [browsingCurrency.data, feedHeight]);

  const emptyContent = products.isPending ? (
    <View style={[styles.feedPage, { height: feedHeight || 560 }]}>
      <ProductFeedSkeleton />
    </View>
  ) : products.isError ? (
    <View style={[styles.feedState, { minHeight: feedHeight || 560 }]}>
      <ErrorState title={translate("catalogLoadError")} retryLabel={translate("retry")} busy={products.isFetching} onRetry={() => void products.refetch()} />
    </View>
  ) : (
    <View style={[styles.feedState, { minHeight: feedHeight || 560 }]}>
      <EmptyState icon="package" title={translate("homeNoProducts")} hint={translate("homeNoProductsHint")} />
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <View style={styles.screenHeader}>
        <CustomerMainHeader />
      </View>
      <View style={styles.feedViewport} onLayout={handleFeedLayout}>
        <PullToRefresh
          refreshing={products.isFetching || browsingCurrency.isFetching}
          onRefresh={() => { void Promise.all([products.refetch(), browsingCurrency.refetch()]); }}
          renderContent={(onScroll) => (
            <FlatList
          ref={feedListRef}
          data={products.data ?? []}
          renderItem={renderProduct}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={emptyContent}
          pagingEnabled
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          updateCellsBatchingPeriod={50}
          windowSize={3}
          removeClippedSubviews
          getItemLayout={feedHeight > 0 ? (_data, index) => ({
            length: feedHeight,
            offset: feedHeight * index,
            index
          }) : undefined}
          contentContainerStyle={styles.feedListContent}
            />
          )}
        />
      </View>
      <CustomerNavigation />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  screenHeader: { paddingHorizontal: designTokens.spacing.xl, paddingTop: designTokens.spacing.sm, paddingBottom: designTokens.spacing.sm },
  feedViewport: { flex: 1 },
  feedListContent: { flexGrow: 1, paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 },
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
