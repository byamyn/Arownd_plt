import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, PanResponder, StyleSheet, View } from "react-native";

import { CustomerFlatList, CustomerHeading, EmptyState, ErrorState, ProductTile, SectionTitle } from "@/components/customer-ui";
import { CustomerMainHeader } from "@/components/customer-main-header";
import { fetchHomeProducts, fetchProductDetails, fetchProductOffers, formatMarketPrice, getPrimaryImage, searchCatalogProducts } from "@/lib/catalog";
import { BROWSING_CURRENCY_QUERY_KEY, fetchBrowsingCurrencyCode } from "@/lib/country-service";
import { fetchApprovedReviews } from "@/lib/reviews";
import { translate, useLanguage } from "@/lib/i18n";
import { getLocalizedProductCategoryLabel } from "@/lib/locale-data";
import { designTokens, useAppTheme } from "@/lib/theme";
import { CategorySelectorTile, ProductCardSkeleton, SearchField, Text as UiText } from "@/components/ui";

const categories = [
  { id: "fashion", icon: "shirt" },
  { id: "electronics", icon: "smartphone" },
  { id: "beauty", icon: "sparkles" },
  { id: "home", icon: "house" },
  { id: "misc", icon: "package" }
] as const;

export default function ExploreScreen() {
  const { language } = useLanguage();
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const browsingCurrency = useQuery({ queryKey: BROWSING_CURRENCY_QUERY_KEY, queryFn: fetchBrowsingCurrencyCode, staleTime: 60_000 });
  const params = useLocalSearchParams<{ q?: string; category?: string }>();
  const initialQuery = typeof params.q === "string" ? params.q : "";
  const category = typeof params.category === "string" ? params.category : undefined;
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [railWidth, setRailWidth] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureStartX = useRef(0);
  const currentTranslateX = useRef(0);
  const categoryMetrics = useRef({ viewportWidth: 0, railWidth: 0, language });
  categoryMetrics.current = { viewportWidth, railWidth, language };
  useEffect(() => {
    const listenerId = translateX.addListener(({ value }) => {
      currentTranslateX.current = value;
    });
    return () => translateX.removeListener(listenerId);
  }, [translateX]);

  const resumeCategoryAnimation = () => {
    const { viewportWidth: width, railWidth: contentWidth } = categoryMetrics.current;
    if (width <= 0 || contentWidth <= width) return;
    const currentX = currentTranslateX.current;
    const animation = Animated.loop(
      Animated.timing(translateX, {
        toValue: currentX - contentWidth,
        duration: Math.max(28_000, Math.round(contentWidth * 45)),
        easing: Easing.linear,
        useNativeDriver: true
      })
    );
    animationRef.current = animation;
    animation.start();
  };
  const categoryPanResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) =>
      Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderGrant: () => {
      animationRef.current?.stop();
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      gestureStartX.current = currentTranslateX.current;
    },
    onPanResponderMove: (_event, gesture) => {
      const { viewportWidth: width, railWidth: contentWidth, language: currentLanguage } = categoryMetrics.current;
      const rtlStart = -(contentWidth - width);
      const maxX = currentLanguage === "ar" ? rtlStart : 0;
      const minX = maxX - contentWidth;
      translateX.setValue(Math.max(minX, Math.min(maxX, gestureStartX.current + gesture.dx)));
    },
    onPanResponderRelease: () => {
      resumeTimerRef.current = setTimeout(resumeCategoryAnimation, 900);
    },
    onPanResponderTerminate: () => {
      resumeTimerRef.current = setTimeout(resumeCategoryAnimation, 900);
    }
  })).current;
  const hasActiveFilter = Boolean(debouncedQuery || category);

  useEffect(() => setQuery(initialQuery), [initialQuery]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (viewportWidth <= 0 || railWidth <= viewportWidth) return;

    const startOffset = language === "ar" ? -(railWidth - viewportWidth) : 0;
    translateX.setValue(startOffset);

    const animation = Animated.loop(
      Animated.timing(translateX, {
        toValue: startOffset - railWidth,
        duration: Math.max(28_000, Math.round(railWidth * 45)),
        easing: Easing.linear,
        useNativeDriver: true
      })
    );

    animationRef.current = animation;
    animation.start();

    return () => {
      animation.stop();
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      if (animationRef.current === animation) animationRef.current = null;
    };
  }, [language, railWidth, translateX, viewportWidth]);

  const normalized = debouncedQuery;
  const products = useQuery({
    queryKey: ["customer-explore-products", normalized, category],
    queryFn: ({ signal }) => normalized || category
      ? searchCatalogProducts(normalized, category, signal)
      : fetchHomeProducts(signal),
    staleTime: 30_000,
    enabled: hasActiveFilter
  });

  const orderedCategories = language === "ar" ? [...categories].reverse() : categories;

  const renderCategory = (item: (typeof categories)[number], instance: "primary" | "duplicate") => {
    const selected = category === item.id;

    return (
      <CategorySelectorTile
        key={`${instance}-${item.id}`}
        label={getLocalizedProductCategoryLabel(item.id, language)}
        accessibilityLabel={getLocalizedProductCategoryLabel(item.id, language)}
        icon={item.icon}
        selected={selected}
        onPress={() => {
          animationRef.current?.stop();
          if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
          resumeTimerRef.current = setTimeout(() => animationRef.current?.start(), 900);
          router.setParams({ category: selected ? undefined : item.id });
        }}
      />
    );
  };

  const listHeader = (
    <View style={{ gap: designTokens.spacing.xxl }}>
      <View style={styles.topSection}>
        <CustomerMainHeader />
        <View style={styles.search}>
          <SearchField value={query} onChangeText={setQuery} placeholder={translate("homeSearchPlaceholder")} accessibilityLabel={translate("homeSearchPlaceholder")} style={{ backgroundColor: "transparent", borderRadius: theme.radius.pill }} />
        </View>
        <CustomerHeading title={translate("exploreTitle")} subtitle={translate("exploreSubtitle")} />
      </View>
      <View>
        <SectionTitle title={translate("homeCategories")} />
        <View style={styles.categoryViewport} onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)} {...categoryPanResponder.panHandlers}>
          <Animated.View style={[styles.categoryTrack, { transform: [{ translateX }] }]}>
            <View style={styles.categoryGroup} onLayout={(event) => setRailWidth(event.nativeEvent.layout.width)}>
              {orderedCategories.map((item) => renderCategory(item, "primary"))}
            </View>
            <View style={styles.categoryGroup} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {orderedCategories.map((item) => renderCategory(item, "duplicate"))}
            </View>
          </Animated.View>
        </View>
      </View>
    </View>
  );

  const listEmpty = !hasActiveFilter ? undefined : products.isPending ? (
    <View style={styles.grid}>{[0, 1, 2, 3].map((item) => <ProductCardSkeleton key={item} style={{ width: "47%", flex: 0 }} />)}</View>
  ) : products.isError ? (
    <ErrorState title={translate("catalogLoadError")} retryLabel={translate("retry")} onRetry={() => void products.refetch()} />
  ) : (
    <EmptyState title={translate("exploreNoResults")} hint={translate("exploreNoResultsHint")} />
  );
  const listData = hasActiveFilter && !products.isPending && !products.isError ? products.data ?? [] : [];

  return (
    <CustomerFlatList
      data={listData}
      keyExtractor={(item) => item.id}
      numColumns={2}
      columnWrapperStyle={styles.gridRow}
      renderItem={({ item }) => (
        <ProductTile
          name={item.product.name}
          store={item.store.name}
          price={browsingCurrency.data ? formatMarketPrice(item.price, browsingCurrency.data) : "—"}
          imageUrl={getPrimaryImage(item)}
          onPress={() => {
            void queryClient.prefetchQuery({ queryKey: ["customer-product", item.product.id], queryFn: () => fetchProductDetails(item.product.id), staleTime: 60_000 });
            void queryClient.prefetchQuery({ queryKey: ["customer-product-offers", item.product.id], queryFn: () => fetchProductOffers(item.product.id), staleTime: 30_000 });
            void queryClient.prefetchQuery({ queryKey: ["approved-reviews", "product", item.product.id], queryFn: () => fetchApprovedReviews("product", item.product.id), staleTime: 60_000 });
            router.push({ pathname: "/product/[productId]", params: { productId: item.product.id } });
          }}
          style={styles.productTile}
        />
      )}
      ListHeaderComponent={listHeader}
      ListEmptyComponent={listEmpty}
      ListFooterComponent={hasActiveFilter ? <UiText style={[styles.footer, { color: theme.colors.muted }]}>{translate("exploreFooter")}</UiText> : undefined}
      refreshing={hasActiveFilter && products.isFetching}
      onRefresh={hasActiveFilter ? () => { void products.refetch(); } : undefined}
      initialNumToRender={6}
      maxToRenderPerBatch={6}
      updateCellsBatchingPeriod={50}
      windowSize={5}
      removeClippedSubviews
      keyboardShouldPersistTaps="handled"
    />
  );
}

const styles = StyleSheet.create({
  topSection: { gap: designTokens.spacing.md },
  search: { width: "100%" },

  categoryViewport: { overflow: "hidden" },
  categoryTrack: { flexDirection: "row", alignItems: "center", direction: "ltr" },
  categoryGroup: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.sm, paddingRight: designTokens.spacing.sm, flexShrink: 0, direction: "ltr" },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: designTokens.spacing.md },
  gridRow: { justifyContent: "space-between" },
  productTile: { width: "47%", flexGrow: 0, flexShrink: 0 },
  footer: { fontSize: designTokens.typography.caption, textAlign: "center", padding: designTokens.spacing.lg }
});
