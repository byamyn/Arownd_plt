import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { CustomerFlatList, EmptyState, ErrorState, ProductTile, SectionTitle, StoreTile } from "@/components/customer-ui";
import { CustomerMainHeader } from "@/components/customer-main-header";
import { fetchProductDetails, fetchProductOffers, fetchStoreDetails, fetchStoreOffers, formatMarketPrice, getPrimaryImage, searchCatalogProducts, searchCatalogStores } from "@/lib/catalog";
import { BROWSING_CURRENCY_QUERY_KEY, fetchBrowsingCurrencyCode } from "@/lib/country-service";
import { fetchApprovedReviews } from "@/lib/reviews";
import { translate } from "@/lib/i18n";
import { designTokens, useAppTheme } from "@/lib/theme";
import { Icon, SearchField, Text as UiText } from "@/components/ui";

const SEARCH_HISTORY_KEY = "arownd:explore-search-history";
type SearchTab = "all" | "products" | "stores";

export default function ExploreScreen() {
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ q?: string }>();
  const initialQuery = typeof params.q === "string" ? params.q : "";
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery.trim());
  const [activeTab, setActiveTab] = useState<SearchTab>("all");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const browsingCurrency = useQuery({
    queryKey: BROWSING_CURRENCY_QUERY_KEY,
    queryFn: ({ signal }) => fetchBrowsingCurrencyCode(signal),
    staleTime: 60_000
  });

  useEffect(() => setQuery(initialQuery), [initialQuery]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(SEARCH_HISTORY_KEY).then((value) => {
      if (!mounted || !value) return;
      try {
        const parsed: unknown = JSON.parse(value);
        if (Array.isArray(parsed)) {
          setRecentSearches(parsed.filter((item): item is string => typeof item === "string").slice(0, 8));
        }
      } catch {
        setRecentSearches([]);
      }
    }).catch(() => undefined);
    return () => { mounted = false; };
  }, []);

  const search = useQuery({
    queryKey: ["customer-explore-search", debouncedQuery],
    queryFn: async ({ signal }) => {
      const [products, stores] = await Promise.all([
        searchCatalogProducts(debouncedQuery, undefined, signal),
        searchCatalogStores(debouncedQuery, signal)
      ]);
      return { products, stores };
    },
    enabled: debouncedQuery.length > 0,
    staleTime: 30_000
  });

  useEffect(() => {
    if (!debouncedQuery || search.isPending || search.isError || !search.data) return;
    const timer = setTimeout(() => {
      setRecentSearches((current) => {
        const next = [debouncedQuery, ...current.filter((item) => item !== debouncedQuery)].slice(0, 8);
        void AsyncStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next)).catch(() => undefined);
        return next;
      });
    }, 1_000);
    return () => clearTimeout(timer);
  }, [query, debouncedQuery, search.data, search.isError, search.isPending]);

  const selectRecentSearch = (value: string) => {
    setQuery(value);
    setActiveTab("all");
  };

  const clearHistory = () => {
    setRecentSearches([]);
    void AsyncStorage.removeItem(SEARCH_HISTORY_KEY).catch(() => undefined);
  };

  const isSearching = query.trim().length > 0;
  const isDebouncing = query.trim() !== debouncedQuery;
  const searchPending = isDebouncing || search.isPending;
  const stores = isDebouncing ? [] : search.data?.stores ?? [];
  const products = isDebouncing ? [] : search.data?.products ?? [];
  const showStores = activeTab !== "products" && stores.length > 0;
  const showProducts = activeTab !== "stores";
  const listData = isSearching && !searchPending && !search.isError && showProducts ? products : [];

  const listHeader = (
    <View style={styles.headerContent}>
      <CustomerMainHeader variant="settings" />
      <SearchField
        value={query}
        onChangeText={(value) => {
          setQuery(value);
          if (!value.trim()) setActiveTab("all");
        }}
        placeholder={translate("homeSearchPlaceholder")}
        accessibilityLabel={translate("homeSearchPlaceholder")}
        style={{ backgroundColor: theme.colors.surfaceSecondary, borderRadius: theme.radius.pill }}
      />

      {!isSearching ? (
        <View style={styles.historySection}>
          <SectionTitle
            title={translate("exploreRecent")}
            action={recentSearches.length > 0 ? translate("exploreClear") : ""}
            onAction={clearHistory}
          />
          {recentSearches.length > 0 ? recentSearches.map((item) => (
            <Pressable key={item} onPress={() => selectRecentSearch(item)} style={styles.historyItem}>
              <Icon name="clock" size={17} color={theme.colors.muted} accessibilityHidden />
              <UiText numberOfLines={1} style={styles.historyText}>{item}</UiText>
              <Icon name="arrow-left" size={16} color={theme.colors.subtle} accessibilityHidden />
            </Pressable>
          )) : (
            <UiText style={{ color: theme.colors.muted }}>{translate("exploreSearchHint")}</UiText>
          )}
        </View>
      ) : (
        <View style={styles.resultsSection}>
          <View style={styles.tabs}>
            {(["all", "products", "stores"] as const).map((tab) => {
              const selected = activeTab === tab;
              const label = tab === "all" ? translate("ordersTabAll") : tab === "products" ? translate("favoriteProducts") : translate("favoriteStores");
              return (
                <Pressable
                  key={tab}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setActiveTab(tab)}
                  style={[styles.tab, selected && { borderBottomColor: theme.colors.accent, borderBottomWidth: 2 }]}
                >
                  <UiText weight={selected ? "700" : "500"} style={{ color: selected ? theme.colors.accent : theme.colors.foreground }}>{label}</UiText>
                </Pressable>
              );
            })}
          </View>

          {searchPending ? (
            <UiText style={{ color: theme.colors.muted }}>{translate("stateLoading")}</UiText>
          ) : search.isError ? (
            <ErrorState title={translate("catalogLoadError")} retryLabel={translate("retry")} onRetry={() => void search.refetch()} />
          ) : (
            <>
              {showStores ? (
                <View style={styles.resultGroup}>
                  <SectionTitle title={translate("exploreStoreResults")} />
                  {stores.map((store) => (
                    <StoreTile
                      key={store.id}
                      name={store.name}
                      description={store.description}
                      logoUrl={store.logo_url}
                      commune={store.commune}
                      rating={store.rating}
                      verified={store.is_verified}
                      onPress={() => {
                        void queryClient.prefetchQuery({ queryKey: ["customer-store", store.id], queryFn: ({ signal }) => fetchStoreDetails(store.id, signal), staleTime: 60_000 });
                        void queryClient.prefetchQuery({ queryKey: ["customer-store-offers", store.id], queryFn: ({ signal }) => fetchStoreOffers(store.id, signal), staleTime: 30_000 });
                        router.push({ pathname: "/store/[storeId]", params: { storeId: store.id } });
                      }}
                    />
                  ))}
                </View>
              ) : null}
              {showProducts && products.length > 0 ? (
                <SectionTitle title={translate("exploreProductResults")} />
              ) : null}
              {activeTab === "stores" && stores.length === 0 ? (
                <EmptyState title={translate("exploreNoResults")} hint={translate("exploreNoResultsHint")} />
              ) : null}
              {activeTab === "products" && products.length === 0 ? (
                <EmptyState title={translate("exploreNoResults")} hint={translate("exploreNoResultsHint")} />
              ) : null}
              {activeTab === "all" && stores.length === 0 && products.length === 0 ? (
                <EmptyState title={translate("exploreNoResults")} hint={translate("exploreNoResultsHint")} />
              ) : null}
            </>
          )}
        </View>
      )}
    </View>
  );

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
            void queryClient.prefetchQuery({ queryKey: ["customer-product", item.product.id], queryFn: ({ signal }) => fetchProductDetails(item.product.id, signal), staleTime: 60_000 });
            void queryClient.prefetchQuery({ queryKey: ["customer-product-offers", item.product.id], queryFn: ({ signal }) => fetchProductOffers(item.product.id, signal), staleTime: 30_000 });
            void queryClient.prefetchQuery({ queryKey: ["approved-reviews", "product", item.product.id], queryFn: ({ signal }) => fetchApprovedReviews("product", item.product.id, signal), staleTime: 60_000 });
            router.push({ pathname: "/product/[productId]", params: { productId: item.product.id } });
          }}
          style={styles.productTile}
        />
      )}
      ListHeaderComponent={listHeader}
      refreshing={isSearching && !searchPending && (search.isFetching || browsingCurrency.isFetching)}
      onRefresh={isSearching && !searchPending ? () => { void Promise.all([search.refetch(), browsingCurrency.refetch()]); } : undefined}
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
  headerContent: { gap: designTokens.spacing.lg },
  historySection: { gap: designTokens.spacing.sm },
  historyItem: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E8E6DC" },
  historyText: { flex: 1 },
  resultsSection: { gap: designTokens.spacing.lg },
  tabs: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E8E6DC" },
  tab: { minHeight: 40, paddingHorizontal: designTokens.spacing.sm, justifyContent: "center", alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  resultGroup: { gap: designTokens.spacing.sm },
  gridRow: { justifyContent: "space-between" },
  productTile: { width: "47%", flexGrow: 0, flexShrink: 0 }
});
