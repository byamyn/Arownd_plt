import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { designTokens, useAppTheme, type AppTheme } from "@/lib/theme";
import { FavoriteButton as FavoriteToggle, FAVORITES_QUERY_KEY } from "@/components/favorite-button";
import {
  AppHeader,
  Caption,
  Heading,
  Icon,
  IconButton,
  Image,
  ProductCardSkeleton,
  StoreCardSkeleton,
  RatingStars,
  SegmentedControl,
  StoreCard,
  Text as UiText
} from "@/components/ui";
import {
  CustomerScreen,
  EmptyState,
  ErrorState,
  ProductTile,
} from "@/components/customer-ui";
import { chooseBestProductOffer, fetchProductDetails, fetchProductOffers, fetchStoreDetails, fetchStoreOffers, formatMarketPrice, getPrimaryImage } from "@/lib/catalog";
import { BROWSING_CURRENCY_QUERY_KEY, fetchBrowsingCurrencyCode } from "@/lib/country-service";
import { fetchApprovedReviews } from "@/lib/reviews";
import { getFavorites } from "@/lib/favorites";
import type { FavoriteKind } from "@/lib/favorites-state";
import { translate, useLanguage } from "@/lib/i18n";

type FavoriteTab = FavoriteKind;

export default function FavoritesScreen() {
  useLanguage();
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const browsingCurrency = useQuery({ queryKey: BROWSING_CURRENCY_QUERY_KEY, queryFn: ({ signal }) => fetchBrowsingCurrencyCode(signal), staleTime: 60_000 });
  const styles = createStyles(theme);
  const [tab, setTab] = useState<FavoriteTab>("products");
  const favorites = useQuery({ queryKey: FAVORITES_QUERY_KEY, queryFn: getFavorites });
  const content = useQuery({
    queryKey: ["customer-favorites-content", tab, tab === "products" ? favorites.data?.products : favorites.data?.stores],
    enabled: Boolean(favorites.data),
    staleTime: 30_000,
    queryFn: async () => {
      const ids = favorites.data;
      if (!ids) return { products: [], stores: [] };
      if (tab === "products") {
        const productResults = await Promise.all(ids.products.map(async (id) => {
          const offers = await queryClient.fetchQuery({
            queryKey: ["customer-product-offers", id],
            queryFn: ({ signal }) => fetchProductOffers(id, signal),
            staleTime: 30_000
          });
          const best = chooseBestProductOffer(offers);
          return best ? { id, offer: best } : null;
        }));
        return {
          products: productResults.flatMap((item) => item === null ? [] : [item]),
          stores: []
        };
      }
      const storeResults = await Promise.all(ids.stores.map(async (id) => ({
        id,
        store: await queryClient.fetchQuery({
          queryKey: ["customer-store", id],
          queryFn: ({ signal }) => fetchStoreDetails(id, signal),
          staleTime: 60_000
        })
      })));
      return {
        products: [],
        stores: storeResults.flatMap((item) => item.store === null ? [] : [item])
      };
    }
  });

  if (favorites.isPending) {
    return <CustomerScreen>
      <AppHeader title={translate("favoritesTitle")} leading={<IconButton accessibilityLabel={translate("back")} onPress={() => router.back()} icon={<Icon name="arrow-right" size={20} />} variant="ghost" />} />
      <View style={styles.productGrid}>
        {[0, 1, 2, 3].map((item) => <ProductCardSkeleton key={item} style={styles.productItem} />)}
      </View>
    </CustomerScreen>;
  }
  if (favorites.isError) {
    return <CustomerScreen refreshing={favorites.isFetching} onRefresh={() => { void favorites.refetch(); }}><ErrorState title={translate("catalogLoadError")} retryLabel={translate("retry")} busy={favorites.isFetching} onRetry={() => void favorites.refetch()} /></CustomerScreen>;
  }

  const count = tab === "products" ? favorites.data.products.length : favorites.data.stores.length;
  const visibleCount = content.data
    ? tab === "products" ? content.data.products.length : content.data.stores.length
    : count;

  return (
    <CustomerScreen
      refreshing={favorites.isFetching || browsingCurrency.isFetching || content.isFetching}
      onRefresh={() => {
        void favorites.refetch().then(() => queryClient.invalidateQueries({ queryKey: ["customer-favorites-content"] }));
      }}
    >
      <AppHeader
        title={translate("favoritesTitle")}
        leading={<IconButton accessibilityLabel={translate("back")} onPress={() => router.back()} icon={<Icon name="arrow-right" size={20} />} variant="ghost" />}
      />
      <Caption>{translate("favoritesSubtitle")}</Caption>
      <SegmentedControl
        accessibilityLabel={translate("favoritesTitle")}
        value={tab}
        onChange={(value) => { if (value === "products" || value === "stores") setTab(value); }}
        options={[
          { key: "products", label: `${translate("favoriteProducts")} (${favorites.data.products.length})` },
          { key: "stores", label: `${translate("favoriteStores")} (${favorites.data.stores.length})` }
        ]}
      />

      {content.isPending ? (tab === "products" ? (
        <View style={styles.productGrid}>
          {[0, 1, 2, 3].map((item) => <ProductCardSkeleton key={item} style={styles.productItem} />)}
        </View>
      ) : (
        <View style={{ gap: designTokens.spacing.md }}>
          {[0, 1, 2].map((item) => <StoreCardSkeleton key={item} />)}
        </View>
      )) : content.isError ? (
        <ErrorState title={translate("catalogLoadError")} retryLabel={translate("retry")} busy={content.isFetching} onRetry={() => void content.refetch()} />
      ) : visibleCount === 0 ? (
        <EmptyState icon="heart"
          title={translate(tab === "products" ? "favoriteProductsEmpty" : "favoriteStoresEmpty")}
          hint={translate("favoritesEmptyHint")}
        />
      ) : tab === "products" ? (
        <View style={styles.productGrid}>
          {content.data.products.map(({ id, offer }) => (
            <View key={id} style={styles.productItem}>
              <ProductTile
                style={styles.productCard}
                name={offer.product.name}
                store={offer.store.name}
                price={browsingCurrency.data ? formatMarketPrice(offer.price, browsingCurrency.data) : "—"}
                imageUrl={getPrimaryImage(offer)}
                action={<FavoriteToggle kind="products" id={id} />}
                onPress={() => {
                  void queryClient.prefetchQuery({ queryKey: ["customer-product", id], queryFn: ({ signal }) => fetchProductDetails(id, signal), staleTime: 60_000 });
                  void queryClient.prefetchQuery({ queryKey: ["customer-product-offers", id], queryFn: () => fetchProductOffers(id), staleTime: 30_000 });
                  void queryClient.prefetchQuery({ queryKey: ["approved-reviews", "product", id], queryFn: ({ signal }) => fetchApprovedReviews("product", id, signal), staleTime: 60_000 });
                  router.push({ pathname: "/product/[productId]", params: { productId: id } });
                }}
              />
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.storeList}>
          {content.data.stores.map(({ id, store }) => store ? (
            <StoreCard
              key={id}
              style={styles.storeCard}
              onPress={() => {
                void queryClient.prefetchQuery({ queryKey: ["customer-store", id], queryFn: () => fetchStoreDetails(id), staleTime: 60_000 });
                void queryClient.prefetchQuery({ queryKey: ["customer-store-offers", id], queryFn: ({ signal }) => fetchStoreOffers(id, signal), staleTime: 30_000 });
                router.push({ pathname: "/store/[storeId]", params: { storeId: id } });
              }}
              accessibilityLabel={store.name}
              contentStyle={styles.storeContent}
              media={
                <Image
                  uri={store.logo_url ?? undefined}
                  accessibilityLabel={store.name}
                  aspectRatio={1}
                  style={styles.storeLogo}
                />
              }
              actions={<View style={styles.storeFavorite}><FavoriteToggle kind="stores" id={id} /></View>}
            >
              <View style={styles.storeInfo}>
                <Heading level={3}>{store.name}</Heading>
                {store.commune ? <Caption>{store.commune}</Caption> : null}
                {store.description ? <UiText tone="muted" numberOfLines={2}>{store.description}</UiText> : null}
                {store.rating != null ? <RatingStars value={store.rating} size={14} showValue /> : null}
              </View>
            </StoreCard>
          ) : null)}
        </View>
      )}
    </CustomerScreen>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    productGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      gap: designTokens.spacing.md
    },
    productItem: { width: "48%" },
    productCard: { width: "100%" },
    storeList: { gap: 0 },
    storeCard: {
      backgroundColor: "transparent",
      borderColor: "transparent",
      borderRadius: 0
    },
    storeContent: {
      flexDirection: "row",
      alignItems: "center",
      gap: designTokens.spacing.md,
      paddingVertical: designTokens.spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.divider
    },
    storeInfo: {
      flex: 1,
      minWidth: 0,
      alignItems: "flex-start",
      gap: designTokens.spacing.xs
    },
    storeLogo: {
      width: 76,
      aspectRatio: 1,
      borderRadius: designTokens.radius.md,
      backgroundColor: theme.mode === "dark" ? theme.colors.surfaceSecondary : theme.colors.surfaceMuted
    },
    storeFavorite: { alignSelf: "center" }
  });
}