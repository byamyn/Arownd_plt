import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { ScrollView, StyleSheet, View } from "react-native";

import { Icon, IconButton, ProductCardSkeleton } from "@/components/ui";
import Logo from "@/components/logo";
import {
  CustomerScreen,
  EmptyState,
  ErrorState,
  SectionTitle,
  ProductTile
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
              <ProductTile
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
                style={{ width: 172, flexGrow: 0, flexShrink: 0 }}
              />
            ))}
          </ScrollView>
        )}
      </View>
    </CustomerScreen>
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
  productRail: { flexDirection: "row", gap: designTokens.spacing.md }
});
