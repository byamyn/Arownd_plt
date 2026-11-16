import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { CustomerScreen, CustomerSearch, EmptyState, ErrorState, ProductTile, SectionTitle } from "@/components/customer-ui";
import { FavoriteButton } from "@/components/favorite-button";
import { fetchProductDetails, fetchProductOffers, fetchStoreDetails, fetchStoreOffers, formatMarketPrice, getPrimaryImage } from "@/lib/catalog";
import { fetchBrowsingCurrencyCode } from "@/lib/country-service";
import { fetchApprovedReviews } from "@/lib/reviews";
import { translate, useLanguage } from "@/lib/i18n";
import { ReviewPanel } from "@/components/review-panel";
import { ContentReportAction } from "@/components/content-report-action";
import { designTokens, useAppTheme } from "@/lib/theme";
import { VerifiedBadge } from "@/components/ui/identity";
import { AppHeader, Avatar, Button, Card, Icon, IconButton, RatingStars, SegmentedControl, StoreCardSkeleton, ProductCardSkeleton, Text as UiText } from "@/components/ui";

type StoreTab = "products" | "about";

export default function StoreDetailsScreen() {
  useLanguage();
  const { storeId } = useLocalSearchParams<{ storeId: string }>();
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const browsingCurrency = useQuery({ queryKey: ["browsing-country-currency"], queryFn: fetchBrowsingCurrencyCode, staleTime: 60_000 });
  const [tab, setTab] = useState<StoreTab>("products");
  const [search, setSearch] = useState("");
  const store = useQuery({
    queryKey: ["customer-store", storeId],
    queryFn: () => fetchStoreDetails(storeId),
    enabled: Boolean(storeId)
  });
  const offers = useQuery({
    queryKey: ["customer-store-offers", storeId],
    queryFn: () => fetchStoreOffers(storeId),
    enabled: Boolean(storeId) && tab === "products"
  });

  const filteredOffers = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return offers.data ?? [];
    return (offers.data ?? []).filter((item) => item.product.name.toLocaleLowerCase().includes(term));
  }, [offers.data, search]);

  if (!storeId) return <CustomerScreen><EmptyState title={translate("detailNotFound")} /></CustomerScreen>;

  if (store.isPending) return <CustomerScreen>
    <AppHeader title="" leading={<IconButton accessibilityLabel={translate("back")} onPress={() => router.back()} icon={<Icon name="chevron-right" color={theme.colors.foreground} size={20} />} />} />
    <StoreCardSkeleton />
    <View style={styles.productGrid}>
      {[0, 1, 2, 3].map((item) => <ProductCardSkeleton key={item} style={styles.productSkeleton} />)}
    </View>
  </CustomerScreen>;
  if (store.isError) {
    return <CustomerScreen refreshing={store.isFetching} onRefresh={() => { void store.refetch(); }}><ErrorState title={translate("catalogLoadError")} retryLabel={translate("retry")} busy={store.isFetching} onRetry={() => void store.refetch()} /></CustomerScreen>;
  }
  if (!store.data) return <CustomerScreen><EmptyState title={translate("detailNotFound")} hint={translate("storeNoDescription")} /></CustomerScreen>;

  const details = store.data;
  return (
    <CustomerScreen
      refreshing={store.isFetching || (tab === "products" && offers.isFetching)}
      onRefresh={() => { void store.refetch(); if (tab === "products") void offers.refetch(); }}
    >
      <AppHeader
        title=""
        leading={<IconButton accessibilityLabel={translate("back")} onPress={() => router.back()} icon={<Icon name="chevron-right" color={theme.colors.foreground} size={20} />} />}
      />

      <Card contentStyle={styles.storeHero}>
        <View style={styles.storeIdentity}>
          <Avatar name={details.name} imageUri={details.logo_url || undefined} size={76} accessibilityLabel={details.name} />
          <View style={styles.storeInfo}>
            <View style={styles.storeNameRow}>
              <UiText style={[styles.storeName, { color: theme.colors.foreground, flexShrink: 1 }]}>{details.name}</UiText>
              {details.is_verified ? <VerifiedBadge size={18} accessibilityLabel={translate("storeVerified")} /> : null}
            </View>
            <View style={styles.locationRow}>
              <Icon name="map-pin" size={14} color={theme.colors.muted} accessibilityHidden />
              <UiText numberOfLines={2} style={[styles.metaText, { color: theme.colors.muted }]}>{details.commune || details.address_line || translate("storeNoAddress")}</UiText>
            </View>
            {details.rating != null ? <RatingStars value={details.rating} showValue /> : null}
          </View>
          <FavoriteButton kind="stores" id={storeId} iconOnly />
        </View>
        {details.instagram_url || details.facebook_url ? (
          <View style={styles.socialLinks}>
            {details.instagram_url ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Instagram"
                onPress={() => void Linking.openURL(details.instagram_url!)}
                style={({ pressed }) => [styles.socialButton, styles.instagramButton, pressed && styles.socialButtonPressed]}
              >
                <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
                  <Rect x={3.25} y={3.25} width={17.5} height={17.5} rx={5.2} stroke="#C13584" strokeWidth={2} />
                  <Circle cx={12} cy={12} r={4.1} stroke="#C13584" strokeWidth={2} />
                  <Circle cx={17.7} cy={6.5} r={1.2} fill="#C13584" />
                </Svg>
              </Pressable>
            ) : null}
            {details.facebook_url ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Facebook"
                onPress={() => void Linking.openURL(details.facebook_url!)}
                style={({ pressed }) => [styles.socialButton, styles.facebookButton, pressed && styles.socialButtonPressed]}
              >
                <Svg width={21} height={21} viewBox="0 0 24 24">
                  <Path d="M14.1 21v-8.2h2.8l.42-3.2H14.1V7.55c0-.93.26-1.56 1.61-1.56h1.72V3.12c-.3-.04-1.33-.12-2.52-.12-2.5 0-4.21 1.53-4.21 4.34V9.6H7.9v3.2h2.8V21h3.4Z" fill="#1877F2" />
                </Svg>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {details.latitude != null && details.longitude != null ? (
          <Button
            label={translate("mapDirections")}
            onPress={() => router.push({ pathname: "/map", params: { storeId, directions: "1" } })}
            variant="outline"
            fullWidth
            startIcon={<Icon name="navigation" size={18} color={theme.colors.foreground} accessibilityHidden />}
          />
        ) : null}
        {details.description ? <UiText numberOfLines={2} style={[styles.storeDescription, { color: theme.colors.muted }]}>{details.description}</UiText> : null}
      </Card>

      <SegmentedControl
        accessibilityLabel={translate("storeAboutTitle")}
        options={[
          { key: "products", label: translate("storeProductsTitle") },
          { key: "about", label: translate("storeAboutTitle") }
        ]}
        value={tab}
        onChange={(value) => {
          if (value === "products" || value === "about") setTab(value);
        }}
        style={styles.tabs}
      />

      {tab === "products" ? (
        offers.isPending ? (
          <View style={styles.productGrid}>
            {[0, 1, 2, 3].map((item) => <ProductCardSkeleton key={item} style={styles.productSkeleton} />)}
          </View>
        ) : offers.isError ? (
          <ErrorState title={translate("catalogLoadError")} retryLabel={translate("retry")} busy={offers.isFetching} onRetry={() => void offers.refetch()} />
        ) : offers.data.length === 0 ? (
          <EmptyState icon="package" title={translate("storeNoProducts")} hint={translate("storeNoDescription")} />
        ) : (
          <View style={styles.productsSection}>
            <SectionTitle title={translate("storeProductsTitle")} />
            <CustomerSearch value={search} onChangeText={setSearch} placeholder={translate("homeSearchPlaceholder")} />
            {filteredOffers.length === 0 ? (
              <EmptyState icon="search" title={translate("exploreNoResults")} hint={translate("exploreNoResultsHint")} />
            ) : (
              <View style={styles.productGrid}>
                {filteredOffers.map((item) => (
                  <ProductTile
                    key={item.id}
                    style={styles.productTile}
                    name={item.product.name}
                    store={details.name}
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
              </View>
            )}
          </View>
        )
      ) : (
        <>
          <Card contentStyle={styles.aboutCard}>
            <UiText style={[styles.aboutTitle, { color: theme.colors.foreground }]}>{translate("storeAboutTitle")}</UiText>
            <UiText style={[styles.description, { color: theme.colors.muted }]}>{details.description || translate("storeNoDescription")}</UiText>
            <UiText style={[styles.fieldTitle, { color: theme.colors.foregroundSecondary }]}>{translate("storeAddress")}</UiText>
            <UiText style={[styles.description, { color: theme.colors.muted }]}>{[details.address_line, details.commune].filter(Boolean).join("، ") || translate("storeNoAddress")}</UiText>
            {details.phone ? <><UiText style={[styles.fieldTitle, { color: theme.colors.foregroundSecondary }]}>{translate("storePhone")}</UiText><UiText style={[styles.description, { color: theme.colors.muted }]}>{details.phone}</UiText></> : null}
            {details.whatsapp ? <><UiText style={[styles.fieldTitle, { color: theme.colors.foregroundSecondary }]}>{translate("storeWhatsApp")}</UiText><UiText style={[styles.description, { color: theme.colors.muted }]}>{details.whatsapp}</UiText></> : null}
          </Card>
          <ContentReportAction targetType="store" targetId={storeId} />
          <ReviewPanel targetType="store" targetId={storeId} />
        </>
      )}
    </CustomerScreen>
  );
}

const styles = StyleSheet.create({
  storeHero: { padding: designTokens.spacing.lg, gap: designTokens.spacing.md },
  storeIdentity: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md },
  socialLinks: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.sm },
  socialButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF", borderWidth: StyleSheet.hairlineWidth, borderColor: "#E5E7EB" },
  instagramButton: { borderColor: "#F2D5E5" },
  facebookButton: { borderColor: "#D7E6FF" },
  socialButtonPressed: { opacity: 0.65, transform: [{ scale: 0.96 }] },
  storeInfo: { flex: 1, alignItems: "flex-start", gap: designTokens.spacing.xs },
  storeNameRow: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.xs, maxWidth: "100%" },
  locationRow: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.xs },
  storeName: { fontSize: designTokens.typography.title - 2, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
  metaText: { fontSize: designTokens.typography.caption + 1, textAlign: "auto", flexShrink: 1 },
  storeDescription: { fontSize: designTokens.typography.body - 1, lineHeight: 21, textAlign: "auto" },
  tabs: { width: "100%" },
  productsSection: { gap: designTokens.spacing.md },
  productGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: designTokens.spacing.lg },
  productTile: { width: "48%" },
  productSkeleton: { width: "48%", flex: 0 },
  aboutCard: { padding: designTokens.spacing.lg, gap: designTokens.spacing.md },
  aboutTitle: { fontSize: designTokens.typography.subtitle + 1, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
  fieldTitle: { fontSize: designTokens.typography.caption + 1, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
  description: { fontSize: designTokens.typography.body - 1, lineHeight: 22, textAlign: "auto" }
});
