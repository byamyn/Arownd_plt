import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { Linking, Pressable, Share, StyleSheet, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { CustomerScreen, CustomerSearch, EmptyState, ErrorState, ProductTile, SectionTitle } from "@/components/customer-ui";
import { FavoriteButton } from "@/components/favorite-button";
import { fetchProductDetails, fetchProductOffers, fetchStoreDetails, fetchStoreOffers, formatMarketPrice, getPrimaryImage } from "@/lib/catalog";
import { fetchBrowsingCurrencyCode } from "@/lib/country-service";
import { fetchMerchantAccess } from "@/lib/merchant";
import { fetchMyMerchantStoreSettings, updateMyMerchantStoreSettings } from "@/lib/merchant-store-settings";
import { MerchantStoreSettingsSchema, type MerchantStoreSettings } from "@/lib/merchant-store-settings-state";
import { STORE_IMAGE_MAX_BYTES, uploadMerchantStoreImage, validateStoreImageAsset } from "@/lib/merchant-store-images";
import { fetchApprovedReviews } from "@/lib/reviews";
import { translate, useLanguage } from "@/lib/i18n";
import { ReviewPanel } from "@/components/review-panel";
import { ContentReportAction } from "@/components/content-report-action";
import { designTokens, useAppTheme } from "@/lib/theme";
import { VerifiedBadge } from "@/components/ui/identity";
import { AppHeader, Avatar, Button, Card, Icon, IconButton, Image as UiImage, SegmentedControl, StoreCardSkeleton, ProductCardSkeleton, Text as UiText, TextField } from "@/components/ui";

type StoreTab = "products" | "about" | "reviews";

function getNextOpening(openingHours: unknown, countryCode?: string | null): { weekday: number; time: string } | null {
  if (!openingHours || typeof openingHours !== "object") return null;
  const hours = openingHours as { open?: unknown; closed_days?: unknown };
  if (typeof hours.open !== "string" || !/^\\d{2}:\\d{2}$/.test(hours.open) || !Array.isArray(hours.closed_days)) return null;
  const timeZone = countryCode ? STORE_TIME_ZONES[countryCode] : undefined;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const today = dayMap[values.weekday ?? ""];
  if (today === undefined) return null;
  const now = Number(values.hour) * 60 + Number(values.minute);
  const [openHour, openMinute] = hours.open.split(":").map(Number);
  const openAt = openHour * 60 + openMinute;
  const closedDays = hours.closed_days.filter((value): value is number => Number.isInteger(value));
  for (let offset = 0; offset < 8; offset += 1) {
    const weekday = (today + offset) % 7;
    if (closedDays.includes(weekday)) continue;
    if (offset === 0 && now >= openAt) continue;
    return { weekday, time: hours.open };
  }
  return null;
}

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
  const [ownerDraft, setOwnerDraft] = useState<MerchantStoreSettings | null>(null);
  const [ownerImageBusy, setOwnerImageBusy] = useState<"logo" | "cover" | null>(null);
  const [ownerImageError, setOwnerImageError] = useState(false);
  const [ownerImageSaved, setOwnerImageSaved] = useState(false);
  const [ownerInlineField, setOwnerInlineField] = useState<"name" | "description" | null>(null);
  const ownerSave = useMutation({
    mutationFn: async () => {
      if (!ownerSettings.data || !ownerDraft || !ownerStoreId) throw new Error("merchant_store_settings_missing");
      const values = MerchantStoreSettingsSchema.parse(ownerDraft);
      await updateMyMerchantStoreSettings(ownerStoreId, values);
    },
    onSuccess: async () => {
      setOwnerEditMode(false);
      setOwnerInlineField(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["customer-store", storeId] }),
        queryClient.invalidateQueries({ queryKey: ["merchant-store-settings", ownerStoreId] }),
        queryClient.invalidateQueries({ queryKey: ["merchant-dashboard", ownerStoreId] }),
        queryClient.invalidateQueries({ queryKey: ["map-stores"] })
      ]);
    }
  });
  useEffect(() => {
    if (ownerSettings.data && (!ownerEditMode || !ownerDraft)) setOwnerDraft(ownerSettings.data);
  }, [ownerSettings.data, ownerEditMode, ownerDraft]);
  const [tab, setTab] = useState<StoreTab>("products");
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
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
    setOwnerImageSaved(false);
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
      const uploaded = await uploadMerchantStoreImage(ownerStoreId, asset, kind);
      const imageField = kind === "logo" ? "logo_url" : "cover_url";
      setOwnerDraft((current) => current ? { ...current, [imageField]: uploaded.url } : current);
      queryClient.setQueryData<MerchantStoreSettings>(
        ["merchant-store-settings", ownerStoreId],
        (current) => current ? { ...current, [imageField]: uploaded.url } : current
      );
      setOwnerImageSaved(true);
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
      stickyHeaderIndices={[0, 2]}
      refreshing={store.isFetching || (tab === "products" && offers.isFetching)}
      onRefresh={() => { void store.refetch(); if (tab === "products") void offers.refetch(); }}
    >
      <AppHeader
        title={details.name}
        leading={<IconButton accessibilityLabel={translate("back")} onPress={() => router.back()} icon={<Icon name="chevron-right" color={theme.colors.foreground} size={20} />} />}
        trailing={<>
          <IconButton accessibilityLabel={translate("storeShare")} onPress={() => { void Share.share({ message: `${translate("storeSharePrefix")} ${details.name}` }); }} icon={<Icon name="share-2" color={theme.colors.foreground} size={19} />} />
          <FavoriteButton kind="stores" id={storeId} iconOnly />
        </>}
        style={styles.stickyStoreHeader}
      />

      <Card contentStyle={styles.storeHero}>
        <View style={styles.coverWrap}>
          {(isStoreOwner && ownerDraft?.cover_url) || details.cover_url ? (
            <UiImage uri={((isStoreOwner && ownerDraft?.cover_url) || details.cover_url) ?? undefined} accessibilityLabel={translate("merchantStoreCover")} aspectRatio={16 / 9} style={styles.coverImage} />
          ) : (
            <View style={[styles.coverImage, { backgroundColor: theme.colors.surfaceMuted }]} />
          )}
          {isStoreOwner ? (
            <Pressable accessibilityRole="button" accessibilityLabel={translate("merchantStoreChangeCover")} onPress={() => void chooseOwnerImage("cover")} style={styles.imageEditButton}>
              <Icon name="camera" size={17} color={theme.colors.foreground} accessibilityHidden />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.storeIdentity}>
          <View style={styles.avatarWrap}>
            <Avatar name={(isStoreOwner && ownerDraft?.name) || details.name} imageUri={(isStoreOwner && ownerDraft?.logo_url) || details.logo_url || undefined} size={76} accessibilityLabel={details.name} />
            {isStoreOwner ? (
              <Pressable accessibilityRole="button" accessibilityLabel={translate("merchantStoreChangeLogo")} onPress={() => void chooseOwnerImage("logo")} style={styles.logoEditButton}>
                <Icon name="camera" size={13} color={theme.colors.foreground} accessibilityHidden />
              </Pressable>
            ) : null}
            <View style={[styles.statusDot, { backgroundColor: getStoreOpenState(details.opening_hours, details.country_code) ? "#16A34A" : "#DC2626", borderColor: theme.colors.surface }]} />
          </View>
          <View style={styles.storeInfo}>
            <View style={styles.storeNameRow}>
              {isStoreOwner && ownerInlineField === "name" ? (
                <View style={styles.inlineField}>
                  <TextField label={translate("merchantStoreSettingsName")} value={ownerDraft?.name ?? details.name} onChangeText={(name) => setOwnerDraft((current) => current ? { ...current, name } : current)} maxLength={100} />
                </View>
              ) : (
                <Pressable disabled={!isStoreOwner || ownerSettings.isPending || !ownerDraft} onPress={() => setOwnerInlineField("name")} style={styles.inlineEditable}>
                  <UiText style={[styles.storeName, { color: theme.colors.foreground, flexShrink: 1 }]}>{(isStoreOwner && ownerDraft?.name) || details.name}</UiText>
                  {isStoreOwner ? <Icon name="pencil" size={14} color={theme.colors.muted} accessibilityHidden /> : null}
                </Pressable>
              )}
              {details.is_verified ? <VerifiedBadge size={18} accessibilityLabel={translate("storeVerified")} /> : null}
            </View>
            {isStoreOwner && ownerInlineField === "description" ? (
              <View style={styles.inlineField}>
                <TextField label={translate("merchantStoreSettingsDescription")} value={ownerDraft?.description ?? details.description ?? ""} onChangeText={(description) => setOwnerDraft((current) => current ? { ...current, description } : current)} multiline maxLength={2000} />
              </View>
            ) : (
              <Pressable disabled={!isStoreOwner} onPress={() => setOwnerInlineField("description")} style={styles.inlineEditable}>
                <UiText numberOfLines={descriptionExpanded ? undefined : 2} style={[styles.storeDescription, { color: theme.colors.muted }]}>{(isStoreOwner && ownerDraft?.description) || details.description || (isStoreOwner ? translate("merchantStoreInlineAddDescription") : "")}</UiText>
                {(details.description?.length ?? 0) > 90 ? <Pressable onPress={() => setDescriptionExpanded((value) => !value)}><UiText style={{ color: theme.colors.accentMuted, fontSize: designTokens.typography.caption, fontWeight: designTokens.fontWeights.semibold }}>{translate(descriptionExpanded ? "storeShowLess" : "storeShowMore")}</UiText></Pressable> : null}
                {isStoreOwner ? <Icon name="pencil" size={14} color={theme.colors.muted} accessibilityHidden /> : null}
              </Pressable>
            )}
            <View style={styles.locationRow}>
              <Icon name="map-pin" size={14} color={theme.colors.muted} accessibilityHidden />
              <UiText numberOfLines={2} style={[styles.metaText, { color: theme.colors.muted }]}>{details.commune || details.address_line || translate("storeNoAddress")}</UiText>
            </View>
            {details.rating != null && details.rating > 0 ? <RatingStars value={details.rating} showValue /> : <UiText style={[styles.nextOpeningText, { color: theme.colors.muted }]}>{translate("storeNoRatingsYet")}</UiText>}
            <View style={[styles.storeStatusBadge, { backgroundColor: getStoreOpenState(details.opening_hours, details.country_code) ? theme.colors.success + "18" : theme.colors.danger + "14" }]}>
              <View style={[styles.storeStatusDot, { backgroundColor: getStoreOpenState(details.opening_hours, details.country_code) ? theme.colors.success : theme.colors.danger }]} />
              <UiText style={[styles.statusLabel, { color: getStoreOpenState(details.opening_hours, details.country_code) ? theme.colors.success : theme.colors.danger }]}>{translate(getStoreOpenState(details.opening_hours, details.country_code) ? "storeOpen" : "storeClosed")}</UiText>
            </View>
            {!getStoreOpenState(details.opening_hours, details.country_code) ? (() => { const next = getNextOpening(details.opening_hours, details.country_code); return next ? <UiText style={[styles.nextOpeningText, { color: theme.colors.muted }]}>{translate("storeNextOpening")} {translate(["merchantWeekdaySunday", "merchantWeekdayMonday", "merchantWeekdayTuesday", "merchantWeekdayWednesday", "merchantWeekdayThursday", "merchantWeekdayFriday", "merchantWeekdaySaturday"][next.weekday])} · {next.time}</UiText> : null; })() : null}
            {!getStoreOpenState(details.opening_hours, details.country_code) ? <UiText style={[styles.nextOpeningText, { color: theme.colors.muted }]}>{translate("storeAcceptingOrdersWhileClosed")}</UiText> : null}
          </View>
        </View>
        {details.latitude != null && details.longitude != null || details.phone ? (
          <View style={styles.storeActionsRow}>
            {details.phone ? <Button label={translate("storeCall")} onPress={() => { void Linking.openURL(`tel:${details.phone!.replace(/[^\\d+]/g, "")}`); }} variant="outline" fullWidth startIcon={<Icon name="phone" size={17} color={theme.colors.foreground} accessibilityHidden />} /> : null}
            {details.latitude != null && details.longitude != null ? <Button label={translate("mapDirections")} onPress={() => router.push({ pathname: "/map", params: { storeId, directions: "1" } })} variant="outline" fullWidth startIcon={<Icon name="navigation" size={17} color={theme.colors.foreground} accessibilityHidden />} /> : null}
          </View>
        ) : null}
        {isStoreOwner && ownerInlineField ? (
          <View style={styles.ownerInlineActions}>
            <Button label={translate("merchantStoreSettingsSave")} size="sm" onPress={() => ownerSave.mutate()} loading={ownerSave.isPending} disabled={!ownerDraft || ownerSave.isPending || ownerSettings.isPending} />
            <Button label={translate("merchantStoreEditCancel")} size="sm" variant="ghost" disabled={ownerSave.isPending} onPress={() => { setOwnerDraft(ownerSettings.data ?? null); setOwnerInlineField(null); ownerSave.reset(); }} />
          </View>
        ) : null}
        {isStoreOwner ? (
          <View style={styles.ownerEditor}>
            {ownerEditMode ? (
              <>
                <UiText style={[styles.ownerEditorTitle, { color: theme.colors.foreground }]}>{translate("merchantStoreInlineEditTitle")}</UiText>
                {ownerSettings.isPending || !ownerDraft ? (
                  <UiText style={[styles.ownerEditorHint, { color: theme.colors.muted }]}>{translate("merchantLoading")}</UiText>
                ) : (
                  <>
                    <TextField label={translate("merchantStoreSettingsName")} value={ownerDraft.name} onChangeText={(name) => setOwnerDraft((current) => current ? { ...current, name } : current)} editable={!ownerSave.isPending} maxLength={100} />
                    <TextField label={translate("merchantStoreSettingsDescription")} value={ownerDraft.description} onChangeText={(description) => setOwnerDraft((current) => current ? { ...current, description } : current)} editable={!ownerSave.isPending} multiline maxLength={2000} />
                    <TextField label={translate("merchantStoreSettingsPhone")} value={ownerDraft.phone} onChangeText={(phone) => setOwnerDraft((current) => current ? { ...current, phone } : current)} editable={!ownerSave.isPending} keyboardType="phone-pad" maxLength={20} />
                    <TextField label={translate("merchantStoreSettingsWhatsapp")} value={ownerDraft.whatsapp} onChangeText={(whatsapp) => setOwnerDraft((current) => current ? { ...current, whatsapp } : current)} editable={!ownerSave.isPending} keyboardType="phone-pad" maxLength={20} />
                    <TextField label={translate("merchantStoreSettingsCommune")} value={ownerDraft.commune} onChangeText={(commune) => setOwnerDraft((current) => current ? { ...current, commune } : current)} editable={!ownerSave.isPending} maxLength={80} />
                    <TextField label={translate("merchantStoreSettingsAddress")} value={ownerDraft.address_line} onChangeText={(address_line) => setOwnerDraft((current) => current ? { ...current, address_line } : current)} editable={!ownerSave.isPending} maxLength={300} />
                    <UiText style={[styles.ownerEditorTitle, { color: theme.colors.foreground }]}>{translate("merchantStoreHoursTitle")}</UiText>
                    <View style={styles.ownerImageActions}>
                      <View style={styles.ownerTimeField}><TextField label={translate("merchantStoreSettingsOpen")} value={ownerDraft.opening_hours.open} onChangeText={(open) => setOwnerDraft((current) => current ? { ...current, opening_hours: { ...current.opening_hours, open } } : current)} editable={!ownerSave.isPending} maxLength={5} placeholder="HH:MM" /></View>
                      <View style={styles.ownerTimeField}><TextField label={translate("merchantStoreSettingsClose")} value={ownerDraft.opening_hours.close} onChangeText={(close) => setOwnerDraft((current) => current ? { ...current, opening_hours: { ...current.opening_hours, close } } : current)} editable={!ownerSave.isPending} maxLength={5} placeholder="HH:MM" /></View>
                    </View>
                    <UiText style={[styles.ownerEditorHint, { color: theme.colors.muted }]}>{translate("merchantStoreSettingsClosedDaysHint")}</UiText>
                    <View style={styles.ownerDays}>
                      {([
                        { value: 6, key: "merchantWeekdaySaturday" },
                        { value: 0, key: "merchantWeekdaySunday" },
                        { value: 1, key: "merchantWeekdayMonday" },
                        { value: 2, key: "merchantWeekdayTuesday" },
                        { value: 3, key: "merchantWeekdayWednesday" },
                        { value: 4, key: "merchantWeekdayThursday" },
                        { value: 5, key: "merchantWeekdayFriday" }
                      ] as const).map((day) => {
                        const selected = ownerDraft.opening_hours.closed_days.includes(day.value);
                        return (
                          <Pressable
                            key={day.value}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                            onPress={() => setOwnerDraft((current) => current ? {
                              ...current,
                              opening_hours: {
                                ...current.opening_hours,
                                closed_days: selected
                                  ? current.opening_hours.closed_days.filter((value) => value !== day.value)
                                  : [...current.opening_hours.closed_days, day.value]
                              }
                            } : current)}
                            style={[styles.ownerDayChip, { backgroundColor: selected ? theme.colors.accent : theme.colors.surfaceMuted, borderColor: selected ? theme.colors.accent : theme.colors.border }]}
                          >
                            <UiText style={{ color: selected ? theme.colors.accentForeground : theme.colors.foreground, fontSize: designTokens.typography.caption }}>{translate(day.key)}</UiText>
                          </Pressable>
                        );
                      })}
                    </View>
                    <UiText style={[styles.ownerEditorTitle, { color: theme.colors.foreground }]}>{translate("merchantStoreSocialTitle")}</UiText>
                    <TextField label="Instagram" value={ownerDraft.instagram_url} onChangeText={(instagram_url) => setOwnerDraft((current) => current ? { ...current, instagram_url } : current)} editable={!ownerSave.isPending} keyboardType="url" autoCapitalize="none" maxLength={300} />
                    <TextField label="Facebook" value={ownerDraft.facebook_url} onChangeText={(facebook_url) => setOwnerDraft((current) => current ? { ...current, facebook_url } : current)} editable={!ownerSave.isPending} keyboardType="url" autoCapitalize="none" maxLength={300} />
                    <TextField label="TikTok" value={ownerDraft.tiktok_url} onChangeText={(tiktok_url) => setOwnerDraft((current) => current ? { ...current, tiktok_url } : current)} editable={!ownerSave.isPending} keyboardType="url" autoCapitalize="none" maxLength={300} />
                    <TextField label={translate("merchantStoreSettingsWebsite")} value={ownerDraft.website_url} onChangeText={(website_url) => setOwnerDraft((current) => current ? { ...current, website_url } : current)} editable={!ownerSave.isPending} keyboardType="url" autoCapitalize="none" maxLength={300} />
                  </>
                )}
                {ownerImageSaved ? <UiText style={[styles.ownerEditorHint, { color: theme.colors.success }]}>{translate("merchantStoreImageSaved")}</UiText> : null}
                <View style={styles.ownerImageActions}>
                  <Button label={translate("merchantStoreChangeLogo")} variant="outline" size="sm" disabled={ownerImageBusy !== null || ownerSave.isPending} loading={ownerImageBusy === "logo"} onPress={() => void chooseOwnerImage("logo")} />
                  <Button label={translate("merchantStoreChangeCover")} variant="outline" size="sm" disabled={ownerImageBusy !== null || ownerSave.isPending} loading={ownerImageBusy === "cover"} onPress={() => void chooseOwnerImage("cover")} />
                </View>
                {ownerImageError ? <UiText style={[styles.ownerEditorHint, { color: theme.colors.danger }]}>{translate("merchantStoreImageUploadError")}</UiText> : null}
                {ownerSave.isError ? <UiText style={[styles.ownerEditorHint, { color: theme.colors.danger }]}>{translate("merchantStoreSettingsSaveError")}</UiText> : null}
                <View style={styles.ownerImageActions}>
                  <Button label={translate("merchantStoreSettingsSave")} onPress={() => ownerSave.mutate()} loading={ownerSave.isPending} disabled={!ownerDraft || ownerImageBusy !== null || ownerSettings.isPending} />
                  <Button label={translate("merchantStoreEditCancel")} variant="ghost" disabled={ownerSave.isPending || ownerImageBusy !== null} onPress={() => { setOwnerDraft(ownerSettings.data ?? null); setOwnerEditMode(false); ownerSave.reset(); setOwnerImageError(false); }} />
                </View>
                <Button label={translate("merchantStoreSettingsTitle")} variant="ghost" size="sm" onPress={() => router.push("/merchant/settings")} startIcon={<Icon name="settings" size={16} color={theme.colors.muted} accessibilityHidden />} />
              </>
            ) : (
              <Button label={translate("merchantStoreCustomize")} onPress={() => { setOwnerDraft(ownerSettings.data ?? null); setOwnerEditMode(true); }} disabled={ownerSettings.isPending || ownerSettings.isError} variant="primary" fullWidth startIcon={<Icon name="palette" size={18} color={theme.colors.accentForeground} accessibilityHidden />} />
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
            {social}
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
  stickyStoreHeader: { backgroundColor: "#FFFFFF", paddingVertical: designTokens.spacing.xs, zIndex: 10 },
  storeHero: { padding: designTokens.spacing.md, gap: designTokens.spacing.sm },
  storeActionsRow: { flexDirection: "row", gap: designTokens.spacing.sm },
  ownerEditor: { gap: designTokens.spacing.md, paddingTop: designTokens.spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#D1D5DB" },
  ownerInlineActions: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.sm },
  inlineEditable: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.xs, maxWidth: "100%" },
  inlineField: { width: "100%", flexShrink: 1 },
  ownerEditorTitle: { fontSize: designTokens.typography.subtitle, fontWeight: designTokens.fontWeights.bold, textAlign: "auto" },
  ownerEditorHint: { fontSize: designTokens.typography.caption, textAlign: "auto" },
  ownerTimeField: { flex: 1, minWidth: 120 },
  ownerDays: { flexDirection: "row", flexWrap: "wrap", gap: designTokens.spacing.xs },
  ownerDayChip: { borderWidth: 1, borderRadius: designTokens.radius.pill, paddingHorizontal: designTokens.spacing.md, paddingVertical: designTokens.spacing.sm },
  ownerImageActions: { flexDirection: "row", flexWrap: "wrap", gap: designTokens.spacing.sm },
  coverImage: { width: "100%", height: 160, borderRadius: designTokens.radius.lg },
  coverWrap: { position: "relative" },
  imageEditButton: { position: "absolute", right: designTokens.spacing.md, bottom: designTokens.spacing.md, width: 36, height: 36, borderRadius: designTokens.radius.pill, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E5E7EB" },
  logoEditButton: { position: "absolute", right: -3, top: -3, width: 26, height: 26, borderRadius: designTokens.radius.pill, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#E5E7EB", zIndex: 2 },
  avatarWrap: { position: "relative", marginTop: -34, marginStart: designTokens.spacing.sm },
  statusDot: { position: "absolute", right: 1, bottom: 2, width: 15, height: 15, borderRadius: 8, borderWidth: 2 },
  statusLabel: { fontSize: designTokens.typography.caption, fontWeight: designTokens.fontWeights.semibold },
  storeStatusBadge: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, paddingHorizontal: 9, paddingVertical: 5, borderRadius: designTokens.radius.pill },
  storeStatusDot: { width: 7, height: 7, borderRadius: 4 },
  nextOpeningText: { fontSize: designTokens.typography.caption, lineHeight: 18 },
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
  tabs: { width: "100%", backgroundColor: "#FFFFFF", zIndex: 9 },
  productsSection: { gap: designTokens.spacing.md },
  productGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: designTokens.spacing.lg },
  productTile: { width: "48%" },
  productSkeleton: { width: "48%", flex: 0 },
  aboutCard: { padding: designTokens.spacing.lg, gap: designTokens.spacing.md },
  aboutTitle: { fontSize: designTokens.typography.subtitle + 1, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
  fieldTitle: { fontSize: designTokens.typography.caption + 1, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
  description: { fontSize: designTokens.typography.body - 1, lineHeight: 22, textAlign: "auto" }
});
