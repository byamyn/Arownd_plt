import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";

import { Caption, Icon, IconButton, Image as UiImage, PriceDisplay, PressableSurface, ProductCardSkeleton, Text as UiText } from "@/components/ui";
import Logo from "@/components/logo";
import {
  CustomerScreen,
  EmptyState,
  ErrorState,
  SectionTitle
} from "@/components/customer-ui";
import { fetchHomeProducts, fetchProductDetails, fetchProductOffers, formatMarketPrice, getPrimaryImage } from "@/lib/catalog";
import { fetchBrowsingCurrencyCode } from "@/lib/country-service";
import { fetchApprovedReviews } from "@/lib/reviews";
import { translate } from "@/lib/i18n";
import { designTokens, useAppTheme } from "@/lib/theme";

export default function CustomerHomeScreen() {
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const browsingCurrency = useQuery({ queryKey: ["browsing-country-currency"], queryFn: fetchBrowsingCurrencyCode, staleTime: 60_000 });
  const products = useQuery({ queryKey: ["customer-home-products"], queryFn: fetchHomeProducts, staleTime: 60_000 });
  return (
    <CustomerScreen
      refreshing={products.isFetching}
      onRefresh={() => { void products.refetch(); }}
    >
      <View style={styles.header}>
        <Logo color={theme.colors.foreground} width={148} />
        <View style={styles.headerActions}>
          <IconButton
            accessibilityLabel={translate("notificationsTitle")}
            onPress={() => router.push("/notifications")}
            icon={<Icon name="bell" size={21} color={theme.colors.foreground} accessibilityHidden />}
            style={[styles.headerIconButton, { backgroundColor: theme.mode === "light" ? theme.colors.surfaceSecondary : theme.colors.surface, borderWidth: theme.mode === "light" ? 0 : 1, borderColor: theme.colors.border }]}
          />
        </View>
      </View>

      <View>
        <SectionTitle title={translate("homeNewArrivals")} />
        {products.isPending ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.productRail}>
            {[0, 1, 2].map((item) => <ProductCardSkeleton key={item} style={{ width: 156, flex: 0 }} />)}
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
          >
            {products.data.map((item) => (
              <HomeProductCard
                key={item.id}
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
              />
            ))}
          </ScrollView>
        )}
      </View>
    </CustomerScreen>
  );
}

function HomeProductCard({
  name,
  store,
  price,
  imageUrl,
  onPress
}: {
  name: string;
  store: string;
  price: string;
  imageUrl: string | null;
  onPress: () => void;
}) {
  const theme = useAppTheme();

  return (
    <PressableSurface
      onPress={onPress}
      accessibilityLabel={`${name}، ${store}، ${price}`}
      style={[
        styles.homeProductCard,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderWidth: theme.mode === "light" ? StyleSheet.hairlineWidth : 1
        }
      ]}
    >
      <View style={[styles.homeProductImage, { backgroundColor: theme.colors.surfaceMuted }]}>
        {imageUrl ? (
          <UiImage uri={imageUrl} accessibilityLabel={name} aspectRatio={1} style={StyleSheet.absoluteFill} />
        ) : (
          <Icon name="image" size={34} color={theme.colors.subtle} accessibilityHidden />
        )}
      </View>
      <View style={styles.homeProductContent}>
        <View style={styles.homeProductStore}>
          <Icon name="store" size={13} color={theme.colors.muted} accessibilityHidden />
          <Caption numberOfLines={1}>{store}</Caption>
        </View>
        <UiText numberOfLines={2} weight="700" style={styles.homeProductName}>{name}</UiText>
        <View style={[styles.homeProductPrice, { borderTopColor: theme.colors.border }]}>
          <PriceDisplay value={price} />
          <Icon name="arrow-left" size={15} color={theme.colors.accent} accessibilityHidden />
        </View>
      </View>
    </PressableSurface>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: designTokens.dimensions.controlHeight.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: designTokens.spacing.sm
  },
  headerIconButton: {
    width: designTokens.dimensions.controlHeight.md,
    height: designTokens.dimensions.controlHeight.md,
    borderRadius: designTokens.radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  productRail: {
    flexDirection: "row",
    gap: designTokens.spacing.md
  },
  homeProductCard: {
    width: 172,
    borderRadius: designTokens.radius.lg,
    padding: designTokens.spacing.sm,
    gap: designTokens.spacing.sm,
    overflow: "hidden"
  },
  homeProductImage: {
    height: 144,
    borderRadius: designTokens.radius.md,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center"
  },
  homeProductContent: {
    gap: designTokens.spacing.sm,
    alignItems: "stretch",
    paddingHorizontal: 2
  },
  homeProductStore: {
    flexDirection: "row",
    alignItems: "center",
    gap: designTokens.spacing.xs,
    minHeight: 18
  },
  homeProductName: {
    minHeight: 40,
    lineHeight: 20,
    textAlign: "auto"
  },
  homeProductPrice: {
    minHeight: 38,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: designTokens.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  }
});
