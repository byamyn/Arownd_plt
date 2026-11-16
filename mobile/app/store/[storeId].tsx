import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { CustomerScreen, CustomerSearch, EmptyState, ErrorState, ProductTile, SectionTitle } from "@/components/customer-ui";
import { FavoriteButton } from "@/components/favorite-button";
import { fetchProductDetails, fetchProductOffers, fetchStoreDetails, fetchStoreOffers, formatMarketPrice, getPrimaryImage } from "@/lib/catalog";
import { fetchBrowsingCurrencyCode } from "@/lib/country-service";
import { fetchMerchantAccess } from "@/lib/merchant";
import { fetchMyMerchantStoreSettings, updateMyMerchantStoreSettings } from "@/lib/merchant-store-settings";
import { MerchantStoreSettingsSchema } from "@/lib/merchant-store-settings-state";
import { STORE_IMAGE_MAX_BYTES, uploadMerchantStoreImage, validateStoreImageAsset } from "@/lib/merchant-store-images";
import { fetchApprovedReviews } from "@/lib/reviews";
import { translate, useLanguage } from "@/lib/i18n";
import { ReviewPanel } from "@/components/review-panel";
import { ContentReportAction } from "@/components/content-report-action";
import { designTokens, useAppTheme } from "@/lib/theme";
import { VerifiedBadge } from "@/components/ui/identity";
import { AppHeader, Avatar, Button, Card, Icon, IconButton, Image as UiImage, RatingStars, SegmentedControl, StoreCardSkeleton, ProductCardSkeleton, Text as UiText, TextField } from "@/components/ui";

type StoreTab = "products" | "about" | "reviews";

const STORE_TIME_ZONES: Record<string, string> = {
  DZ: "Africa/Algiers",
  MA: "Africa/Casablanca",
  EG: "Africa/Cairo",
  SA: "Asia/Riyadh",
  AE: "Asia/Dubai"
};

function getStoreOpenState(openingHours: unknown, countryCode?: string | null): boolean {
  if (!openingHours || typeof openingHours !== "object") return false;
  const hours = openingHours as { open?: unknown; close?: unknown; closed_days?: unknown };
  if (typeof hours.open !== "string" || typeof hours.close !== "string" || !Array.isArray(hours.closed_days)) return false;
  const parseMinutes = (value: string) => {
    const match = /^(\\d{2}):(\\d{2})$/.exec(value);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const open = parseMinutes(hours.open);
  const close = parseMinutes(hours.close);
  if (open === null || close === null) return false;
  const timeZone = countryCode ? STORE_TIME_ZONES[countryCode] : undefined;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = values.weekday;
  if (!weekday || open === close) return false;
  const dayByWeekday: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = dayByWeekday[weekday];
  if (day === undefined) return false;
  const now = Number(values.hour) * 60 + Number(values.minute);
  const closedDays = hours.closed_days.filter((value): value is number => Number.isInteger(value));
  if (close > open) return !closedDays.includes(day) && now >= open && now < close;
  const previousDay = (day + 6) % 7;
  return (!closedDays.includes(day) && now >= open) ||
    (!closedDays.includes(previousDay) && now < close);
}

export default function StoreDetailsScreen() {
  useLanguage();
  const { storeId } = useLocalSearchParams<{ storeId: string }>();
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const browsingCurrency = useQuery({ queryKey: ["browsing-country-currency"], queryFn: fetchBrowsingCurrencyCode, staleTime: 60_000 });
  const merchantAccess = useQuery({ queryKey: ["merchant-access"], queryFn: fetchMerchantAccess, retry: false, staleTime: 30_000 });
  const ownerStoreId = merchantAccess.data?.status === "merchant_ready" &&
    merchantAccess.data.store?.id === storeId ? storeId : null;
  const ownerSettings = useQuery({
    queryKey: ["merchant-store-settings", ownerStoreId],
    queryFn: () => fetchMyMerchantStoreSettings(ownerStoreId ?? ""),
    enabled: Boolean(ownerStoreId),
    retry: false
  });
  const [ownerEditMode, setOwnerEditMode] = useState(false);
  const [ownerDraft, setOwnerDraft] = useState<{ name: string; description: string } | null>(null);
  const [ownerImageBusy, setOwnerImageBusy] = useState<"logo" | "cover" | null>(null);
  const [ownerImageError, setOwnerImageError] = useState(false);
  const ownerSave = useMutation({
    mutationFn: async () => {
      if (!ownerSettings.data || !ownerDraft || !ownerStoreId) throw new Error("merchant_store_settings_missing");
      const values = MerchantStoreSettingsSchema.parse({ ...ownerSettings.data, name: ownerDraft.name, description: ownerDraft.description });
      await updateMyMerchantStoreSettings(ownerStoreId, values);
    },
    onSuccess: async () => {
      setOwnerEditMode(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["customer-store", storeId] }),
        queryClient.invalidateQueries({ queryKey: ["merchant-store-settings", ownerStoreId] }),
        queryClient.invalidateQueries({ queryKey: ["merchant-dashboard", ownerStoreId] }),
        queryClient.invalidateQueries({ queryKey: ["map-stores"] })
      ]);
    }
  });
  useEffect(() => {
    if (ownerSettings.data && !ownerEditMode) setOwnerDraft({ name: ownerSettings.data.name, description: ownerSettings.data.description });
  }, [ownerSettings.data, ownerEditMode]);
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
  const isStoreOwner = ownerStoreId === details.id;
  const chooseOwnerImage = async (kind: "logo" | "cover") => {
    if (!ownerStoreId || ownerImageBusy || ownerSave.isPending) return;
    setOwnerImageBusy(kind);
    setOwnerImageError(false);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"], allowsMultipleSelection: false, selectionLimit: 1, quality: 0.85
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset || (asset.fileSize != null && asset.fileSize > STORE_IMAGE_MAX_BYTES) || !validateStoreImageAsset(asset)) {
        setOwnerImageError(true);
        return;
      }
      await uploadMerchantStoreImage(ownerStoreId, asset, kind);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["customer-store", storeId] }),
        queryClient.invalidateQueries({ queryKey: ["merchant-store-settings", ownerStoreId] }),
        queryClient.invalidateQueries({ queryKey: ["merchant-dashboard", ownerStoreId] }),
        queryClient.invalidateQueries({ queryKey: ["map-stores"] })
      ]);
    } catch {
      setOwnerImageError(true);
    } finally {
      setOwnerImageBusy(null);
    }
  };
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
        {details.cover_url ? (
          <UiImage uri={details.cover_url} accessibilityLabel={translate("merchantStoreCover")} aspectRatio={16 / 9} style={styles.coverImage} />
        ) : (
          <View style={[styles.coverImage, { backgroundColor: theme.colors.surfaceMuted }]} />
        )}
        <View style={styles.storeIdentity}>
          <View style={styles.avatarWrap}>
            <Avatar name={details.name} imageUri={details.logo_url || undefined} size={76} accessibilityLabel={details.name} />
            <View style={[styles.statusDot, { backgroundColor: getStoreOpenState(details.opening_hours, details.country_code) ? "#16A34A" : "#DC2626", borderColor: theme.colors.surface }]} />
          </View>
          <View style={styles.storeInfo}>
            <View style={styles.storeNameRow}>
              <UiText style={[styles.storeName, { color: theme.colors.foreground, flexShrink: 1 }]}>{details.name}</UiText>
              {details.is_verified ? <VerifiedBadge size={18} accessibilityLabel={translate("storeVerified")} /> : null}
            </View>
            {details.description ? <UiText numberOfLines={2} style={[styles.storeDescription, { color: theme.colors.muted }]}>{details.description}</UiText> : null}
            <View style={styles.locationRow}>
              <Icon name="map-pin" size={14} color={theme.colors.muted} accessibilityHidden />
              <UiText numberOfLines={2} style={[styles.metaText, { color: theme.colors.muted }]}>{details.commune || details.address_line || translate("storeNoAddress")}</UiText>
            </View>
            {details.rating != null ? <RatingStars value={details.rating} showValue /> : null}
            <UiText style={[styles.statusLabel, { color: getStoreOpenState(details.opening_hours, details.country_code) ? "#16A34A" : "#DC2626" }]}>
              {translate(getStoreOpenState(details.opening_hours, details.country_code) ? "storeOpen" : "storeClosed")}
            </UiText>
          </View>
          <FavoriteButton kind="stores" id={storeId} iconOnly />
        </View>
        {details.whatsapp || details.instagram_url || details.facebook_url || details.tiktok_url || details.website_url ? (
          <View style={styles.socialLinks}>
            {details.whatsapp ? (
              <Pressable accessibilityRole="link" accessibilityLabel="WhatsApp" onPress={() => {
                const number = details.whatsapp!.replace(/[^\\d]/g, "");
                void Linking.openURL(`https://wa.me/${number}`);
              }} style={({ pressed }) => [styles.socialButton, styles.whatsappButton, pressed && styles.socialButtonPressed]}>
                <Svg width={21} height={21} viewBox="0 0 24 24">
                  <Path d="M20.1 11.8a8.1 8.1 0 0 1-12 7.1L3 20l1.2-5a8.1 8.1 0 1 1 15.9-3.2Z" stroke="#25D366" strokeWidth={1.8} strokeLinejoin="round" fill="none" />
                  <Path d="M8.2 7.8c.2-.4.4-.4.7-.4h.5c.2 0 .3.1.4.4l.7 1.6c.1.2.1.4-.1.6l-.5.6c-.2.2-.2.3-.1.5.4.8 1 1.4 1.8 1.8.2.1.4.1.5-.1l.7-.8c.2-.2.4-.2.6-.1l1.5.7c.2.1.3.2.3.4 0 .3-.2 1.1-.7 1.5-.5.4-1 .6-1.6.5-1-.2-2.2-.8-3.3-1.8-1.1-1-1.8-2.2-2-3.2-.2-.8.1-1.6.6-2.2Z" fill="#25D366" />
                </Svg>
              </Pressable>
            ) : null}
            {details.instagram_url ? (
              <Pressable accessibilityRole="link" accessibilityLabel="Instagram" onPress={() => void Linking.openURL(details.instagram_url!)} style={({ pressed }) => [styles.socialButton, styles.instagramButton, pressed && styles.socialButtonPressed]}>
                <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
                  <Rect x={3.25} y={3.25} width={17.5} height={17.5} rx={5.2} stroke="#C13584" strokeWidth={2} />
                  <Circle cx={12} cy={12} r={4.1} stroke="#C13584" strokeWidth={2} />
                  <Circle cx={17.7} cy={6.5} r={1.2} fill="#C13584" />
                </Svg>
              </Pressable>
            ) : null}
            {details.facebook_url ? (
              <Pressable accessibilityRole="link" accessibilityLabel="Facebook" onPress={() => void Linking.openURL(details.facebook_url!)} style={({ pressed }) => [styles.socialButton, styles.facebookButton, pressed && styles.socialButtonPressed]}>
                <Svg width={21} height={21} viewBox="0 0 24 24">
                  <Path d="M14.1 21v-8.2h2.8l.42-3.2H14.1V7.55c0-.93.26-1.56 1.61-1.56h1.72V3.12c-.3-.04-1.33-.12-2.52-.12-2.5 0-4.21 1.53-4.21 4.34V9.6H7.9v3.2h2.8V21h3.4Z" fill="#1877F2" />
                </Svg>
              </Pressable>
            ) : null}
            {details.tiktok_url ? (
              <Pressable accessibilityRole="link" accessibilityLabel="TikTok" onPress={() => void Linking.openURL(details.tiktok_url!)} style={({ pressed }) => [styles.socialButton, pressed && styles.socialButtonPressed]}>
                <Svg width={21} height={21} viewBox="0 0 24 24">
                  <Path d="M15.2 3h-3.1v11.3a2.6 2.6 0 1 1-2.6-2.6c.4 0 .8.1 1.1.2V8.7a6 6 0 1 0 4.6 5.8V8.8a8 8 0 0 0 4.5 1.4V7.1c-2.5-.1-4.3-1.7-4.5-4.1Z" fill="#111111" />
                  <Path d="M15.2 3h-1.1c.3 2.1 1.9 3.7 4.5 4.1v1.1c.4.1.8.1 1.1.1V7.1c-2.5-.1-4.3-1.7-4.5-4.1Z" fill="#25F4EE" />
                  <Path d="M10.6 8.7v3.2c-.3-.1-.7-.2-1.1-.2a2.6 2.6 0 0 0-2.6 2.6c0 .3 0 .6.1.8a2.6 2.6 0 0 1 4.1-2.1V8.8c-.2-.1-.4-.1-.5-.1Z" fill="#FE2C55" />
                </Svg>
              </Pressable>
            ) : null}
            {details.website_url ? (
              <Pressable accessibilityRole="link" accessibilityLabel={translate("merchantStoreSettingsWebsite")} onPress={() => void Linking.openURL(details.website_url!)} style={({ pressed }) => [styles.socialButton, pressed && styles.socialButtonPressed]}>
                <Icon name="globe" size={21} color="#2563EB" accessibilityHidden />
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
        {isStoreOwner ? (
          <View style={styles.ownerEditor}>
            {ownerEditMode ? (
              <>
                <UiText style={[styles.ownerEditorTitle, { color: theme.colors.foreground }]}>{translate("merchantStoreInlineEditTitle")}</UiText>
                <TextField label={translate("merchantStoreSettingsName")} value={ownerDraft?.name ?? details.name} onChangeText={(name) => setOwnerDraft((current) => ({ name, description: current?.description ?? details.description ?? "" }))} editable={!ownerSave.isPending} maxLength={100} />
                <TextField label={translate("merchantStoreSettingsDescription")} value={ownerDraft?.description ?? details.description ?? ""} onChangeText={(description) => setOwnerDraft((current) => ({ name: current?.name ?? details.name, description }))} editable={!ownerSave.isPending} multiline maxLength={2000} />
                <View style={styles.ownerImageActions}>
                  <Button label={translate("merchantStoreChangeLogo")} variant="outline" size="sm" disabled={ownerImageBusy !== null || ownerSave.isPending} loading={ownerImageBusy === "logo"} onPress={() => void chooseOwnerImage("logo")} />
                  <Button label={translate("merchantStoreChangeCover")} variant="outline" size="sm" disabled={ownerImageBusy !== null || ownerSave.isPending} loading={ownerImageBusy === "cover"} onPress={() => void chooseOwnerImage("cover")} />
                </View>
                {ownerImageError ? <UiText style={[styles.ownerEditorHint, { color: theme.colors.danger }]}>{translate("merchantStoreImageUploadError")}</UiText> : null}
                {ownerSave.isError ? <UiText style={[styles.ownerEditorHint, { color: theme.colors.danger }]}>{translate("merchantStoreSettingsSaveError")}</UiText> : null}
                <View style={styles.ownerImageActions}>
                  <Button label={translate("save")} onPress={() => ownerSave.mutate()} loading={ownerSave.isPending} disabled={!ownerDraft || ownerImageBusy !== null || ownerSettings.isPending} />
                  <Button label={translate("cancel")} variant="ghost" disabled={ownerSave.isPending || ownerImageBusy !== null} onPress={() => { setOwnerDraft({ name: details.name, description: details.description ?? "" }); setOwnerEditMode(false); ownerSave.reset(); setOwnerImageError(false); }} />
                </View>
                <Button label={translate("merchantStoreSettingsTitle")} variant="ghost" size="sm" onPress={() => router.push("/merchant/settings")} startIcon={<Icon name="settings" size={16} color={theme.colors.muted} accessibilityHidden />} />
              </>
            ) : (
              <Button label={translate("merchantStoreCustomize")} onPress={() => { setOwnerDraft({ name: details.name, description: details.description ?? "" }); setOwnerEditMode(true); }} variant="primary" fullWidth startIcon={<Icon name="edit" size={18} color={theme.colors.accentForeground} accessibilityHidden />} />
            )}
          </View>
        ) : null}
      </Card>

      <SegmentedControl
        accessibilityLabel={translate("storeAboutTitle")}
        options={[
          { key: "products", label: translate("storeProductsTitle") },
          { key: "about", label: translate("storeAboutTitle") },
          { key: "reviews", label: translate("storeReviewsTitle") }
        ]}
        value={tab}
        onChange={(value) => {
          if (value === "products" || value === "about" || value === "reviews") setTab(value);
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
      ) : tab === "about" ? (
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
        </>
      ) : (
        <ReviewPanel targetType="store" targetId={storeId} />
      )}
    </CustomerScreen>
  );
}

const styles = StyleSheet.create({
  storeHero: { padding: designTokens.spacing.lg, gap: designTokens.spacing.md },
  ownerEditor: { gap: designTokens.spacing.md, paddingTop: designTokens.spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#D1D5DB" },
  ownerEditorTitle: { fontSize: designTokens.typography.subtitle, fontWeight: designTokens.fontWeights.bold, textAlign: "auto" },
  ownerEditorHint: { fontSize: designTokens.typography.caption, textAlign: "auto" },
  ownerImageActions: { flexDirection: "row", flexWrap: "wrap", gap: designTokens.spacing.sm },
  coverImage: { width: "100%", borderRadius: designTokens.radius.lg },
  avatarWrap: { position: "relative" },
  statusDot: { position: "absolute", right: 1, bottom: 2, width: 15, height: 15, borderRadius: 8, borderWidth: 2 },
  statusLabel: { fontSize: designTokens.typography.caption, fontWeight: designTokens.fontWeights.semibold },
  storeIdentity: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md },
  socialLinks: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.sm },
  socialButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF", borderWidth: StyleSheet.hairlineWidth, borderColor: "#E5E7EB" },
  instagramButton: { borderColor: "#F2D5E5" },
  facebookButton: { borderColor: "#D7E6FF" },
  whatsappButton: { borderColor: "#CDEFD9" },
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
