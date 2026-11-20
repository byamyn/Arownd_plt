import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { RefreshableScrollView, AppHeader, Button, Card, ErrorState, FilterBar, FilterChip, Icon, Image as UiImage, ProductCardSkeleton, MediaViewer, MerchantMetricCard, MerchantStatusBadge, PressableSurface, SearchField, Text as UiText, TextField } from "@/components/ui";
import {
  fetchMerchantAccess
} from "@/lib/merchant";
import {
  fetchMerchantProductOffer,
  fetchMerchantProducts,
  setMerchantProductVisibility,
  updateMerchantProductOffer
} from "@/lib/merchant-products";
import {
  filterMerchantProducts,
  getMerchantInventoryLevel,
  getMerchantInventorySummary,
  validateMerchantOfferValues,
  type MerchantInventoryFilter,
  type MerchantProductOffer
} from "@/lib/merchant-products-state";
import { translate, useLanguage } from "@/lib/i18n";
import { designTokens, useAppTheme, type AppTheme } from "@/lib/theme";

const EMPTY_MERCHANT_PRODUCTS: MerchantProductOffer[] = [];

export default function MerchantProductsScreen() {
  useLanguage();
  const theme = useAppTheme();
  const styles = createStyles(theme);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<MerchantInventoryFilter>("all");
  const [busyOfferId, setBusyOfferId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const access = useQuery({
    queryKey: ["merchant-access"],
    queryFn: ({ signal }) => fetchMerchantAccess(signal),
    retry: false
  });

  const storeId = access.data?.store?.id ?? null;
  const ready = access.data?.status === "merchant_ready" && !!storeId;
  const canManageCatalog = access.data?.teamRole === "owner" || access.data?.teamRole === "admin";

  const products = useQuery({
    queryKey: ["merchant-products", storeId],
    queryFn: ({ signal }) => fetchMerchantProducts(storeId ?? "", signal),
    enabled: ready,
    retry: false
  });

  const allOffers = products.data ?? EMPTY_MERCHANT_PRODUCTS;
  const summary = useMemo(() => getMerchantInventorySummary(allOffers), [allOffers]);
  const visibleOffers = useMemo(
    () => filterMerchantProducts(allOffers, search, filter),
    [allOffers, search, filter]
  );

  const saveOffer = useCallback(async (
    offerId: string,
    priceInput: string,
    stockInput: string
  ): Promise<void> => {
    if (!storeId || busyOfferId) return;

    const values = validateMerchantOfferValues(priceInput, stockInput);
    if (!values) {
      setNotice(null);
      setActionError(translate("merchantProductsValidation"));
      return;
    }

    setBusyOfferId(offerId);
    setNotice(null);
    setActionError(null);

    try {
      await updateMerchantProductOffer(offerId, storeId, values);
      await queryClient.invalidateQueries({ queryKey: ["merchant-products", storeId] });
      await queryClient.invalidateQueries({ queryKey: ["merchant-dashboard", storeId] });
      setNotice(translate("merchantProductsSaved"));
    } catch {
      setActionError(translate("merchantProductsSaveError"));
    } finally {
      setBusyOfferId(null);
    }
  }, [busyOfferId, queryClient, storeId]);

  const toggleVisibility = useCallback(async (offerId: string, isMerchantHidden: boolean): Promise<void> => {
    if (!storeId || busyOfferId) return;

    setBusyOfferId(offerId);
    setNotice(null);
    setActionError(null);

    try {
      await setMerchantProductVisibility(offerId, storeId, isMerchantHidden);
      await queryClient.invalidateQueries({ queryKey: ["merchant-products", storeId] });
      setNotice(translate("merchantProductsSaved"));
    } catch {
      setActionError(translate("merchantProductsVisibilityError"));
    } finally {
      setBusyOfferId(null);
    }
  }, [busyOfferId, queryClient, storeId]);

  const editOffer = useCallback((offerId: string) => {
    if (storeId) {
      void queryClient.prefetchQuery({
        queryKey: ["merchant-product", storeId, offerId],
        queryFn: ({ signal }) => fetchMerchantProductOffer(storeId, offerId, signal),
        staleTime: 30_000
      });
    }
    router.push({ pathname: "/merchant/products/[offerId]", params: { offerId } });
  }, [queryClient, storeId]);

  if (access.isPending) {
    return <MessageScreen theme={theme} loading label={translate("merchantLoading")} />;
  }

  if (access.isError) {
    return (
      <MessageScreen
        theme={theme}
        title={translate("merchantLoadError")}
        actionLabel={translate("merchantRetry")}
        busy={access.isFetching}
        onAction={() => void access.refetch()}
      />
    );
  }

  if (!access.data) return <Redirect href="/login" />;
  if (!ready) return <Redirect href="/merchant" />;

  if (products.isPending) {
    return <MessageScreen theme={theme} loading label={translate("merchantProductsLoading")} />;
  }

  if (products.isError) {
    return (
      <MessageScreen
        theme={theme}
        title={translate("merchantProductsLoadError")}
        actionLabel={translate("merchantRetry")}
        busy={products.isFetching}
        onAction={() => void products.refetch()}
      />
    );
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <RefreshableScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshing={access.isFetching || products.isFetching} onRefresh={() => { void Promise.all([access.refetch(), products.refetch()]); }}>
        <AppHeader title={translate("merchantProductsTitle")} />

        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={translate("merchantProductsSearchPlaceholder")}
          accessibilityLabel={translate("merchantProductsSearchPlaceholder")}
          returnKeyType="search"
          style={styles.searchField}
        />

        <FilterBar style={styles.filters}>
          <FilterChip label={translate("merchantProductsFilterAll")} selected={filter === "all"} onPress={() => setFilter("all")} />
          <FilterChip label={translate("merchantProductsFilterLow")} selected={filter === "low"} onPress={() => setFilter("low")} leading={<Icon name="triangle-alert" size={14} color={filter === "low" ? theme.colors.accentForeground : theme.colors.muted} accessibilityHidden />} />
          <FilterChip label={translate("merchantProductsFilterOut")} selected={filter === "out"} onPress={() => setFilter("out")} leading={<Icon name="package" size={14} color={filter === "out" ? theme.colors.accentForeground : theme.colors.muted} accessibilityHidden />} />
          <FilterChip label={translate("merchantProductsHidden")} selected={filter === "hidden"} onPress={() => setFilter("hidden")} leading={<Icon name="eye-off" size={14} color={filter === "hidden" ? theme.colors.accentForeground : theme.colors.muted} accessibilityHidden />} />
        </FilterBar>

        {canManageCatalog ? <Button label={translate("merchantProductCreateOpen")} onPress={() => router.push("/merchant/products/new")} fullWidth /> : null}

        <View style={styles.summaryGrid}>
          <MerchantMetricCard label={translate("merchantProductsSummaryTotal")} value={String(summary.total)} style={styles.summaryCard} />
          <MerchantMetricCard label={translate("merchantProductsSummaryLow")} value={String(summary.low)} valueTone="warning" style={styles.summaryCard} />
          <MerchantMetricCard label={translate("merchantProductsSummaryOut")} value={String(summary.out)} valueTone="danger" style={styles.summaryCard} />
        </View>

        {notice ? (
          <View style={[styles.feedback, { backgroundColor: theme.colors.successSurface, borderColor: theme.colors.successBorder }]}>
            <UiText style={[styles.feedbackText, { color: theme.mode === "light" ? theme.colors.successText : theme.colors.success }]}>{notice}</UiText>
          </View>
        ) : null}
        {actionError ? (
          <View style={[styles.feedback, { backgroundColor: theme.colors.dangerSurface, borderColor: theme.colors.dangerBorder }]}>
            <UiText style={[styles.feedbackText, { color: theme.mode === "light" ? theme.colors.dangerText : theme.colors.danger }]}>{actionError}</UiText>
          </View>
        ) : null}

        {allOffers.length === 0 ? (
          <Card contentStyle={styles.emptyCard}>
            <UiText style={[styles.emptyTitle, { color: theme.colors.foreground }]}>{translate("merchantProductsEmpty")}</UiText>
            <UiText style={[styles.emptyHint, { color: theme.colors.muted }]}>{translate("merchantProductsEmptyHint")}</UiText>
          </Card>
        ) : visibleOffers.length === 0 ? (
          <Card contentStyle={styles.emptyCard}>
            <UiText style={[styles.emptyTitle, { color: theme.colors.foreground }]}>{translate("merchantProductsNoResults")}</UiText>
          </Card>
        ) : (
          <View style={styles.offerGrid}>
            {visibleOffers.map((offer) => (
              <View key={offer.id} style={styles.offerGridItem}>
                <MerchantOfferCard
                  offer={offer}
                  theme={theme}
                  busy={busyOfferId === offer.id}
                  anyBusy={busyOfferId !== null}
                  canManageCatalog={canManageCatalog}
                  onSave={saveOffer}
                  onToggleVisibility={toggleVisibility}
                  onEdit={editOffer}
                />
              </View>
            ))}
          </View>
        )}
      </RefreshableScrollView>
    </SafeAreaView>
  );
}

const MerchantOfferCard = memo(function MerchantOfferCard({
  offer,
  theme,
  busy,
  anyBusy,
  canManageCatalog,
  onSave,
  onToggleVisibility,
  onEdit
}: {
  offer: MerchantProductOffer;
  theme: AppTheme;
  busy: boolean;
  anyBusy: boolean;
  canManageCatalog: boolean;
  onSave: (offerId: string, price: string, stock: string) => void;
  onToggleVisibility: (offerId: string, isMerchantHidden: boolean) => void;
  onEdit: (offerId: string) => void;
}) {
  const styles = createStyles(theme);
  const [price, setPrice] = useState(String(offer.price));
  const [stock, setStock] = useState(String(offer.stock_quantity));
  const [galleryOpen, setGalleryOpen] = useState(false);

  useEffect(() => {
    setPrice(String(offer.price));
    setStock(String(offer.stock_quantity));
  }, [offer.price, offer.stock_quantity]);

  const handleSave = useCallback(() => onSave(offer.id, price, stock), [onSave, offer.id, price, stock]);
  const handleToggleVisibility = useCallback(() => onToggleVisibility(offer.id, offer.is_merchant_hidden), [onToggleVisibility, offer.id, offer.is_merchant_hidden]);
  const handleEdit = useCallback(() => onEdit(offer.id), [onEdit, offer.id]);
  const image = offer.images.find((item) => item.is_primary) ?? offer.images[0] ?? null;
  const inventoryLevel = getMerchantInventoryLevel(offer.stock_quantity);
  const inventoryLabel = inventoryLevel === "out"
    ? translate("merchantProductsOut")
    : inventoryLevel === "low"
      ? translate("merchantProductsLow")
      : translate("merchantProductsAvailable");

  return (
    <Card style={{ backgroundColor: theme.colors.surface, width: "100%" }} contentStyle={styles.offerCard}>
      <View style={styles.postHeader}>
        <View style={styles.productInfo}>
          <UiText style={[styles.productName, { color: theme.colors.foreground }]} numberOfLines={2}>
            {offer.product.name}
          </UiText>
          {offer.product.brand ? (
            <UiText style={[styles.productBrand, { color: theme.colors.muted }]} numberOfLines={1}>
              {offer.product.brand}
            </UiText>
          ) : null}
        </View>
        <View style={styles.badgeColumn}>
          <MerchantStatusBadge
            label={inventoryLabel}
            tone={inventoryLevel === "out" ? "danger" : inventoryLevel === "low" ? "warning" : "success"}
          />
          <MerchantStatusBadge
            label={offer.is_merchant_hidden ? translate("merchantProductsHidden") : translate("merchantProductsVisible")}
            tone={offer.is_merchant_hidden ? "neutral" : "accent"}
          />
        </View>
      </View>

      <PressableSurface
        accessibilityRole={image ? "button" : undefined}
        accessibilityLabel={translate("merchantProductImagesLabel")}
        disabled={!image}
        onPress={() => setGalleryOpen(true)}
        style={[styles.productImage, { backgroundColor: theme.mode === "dark" ? theme.colors.surfaceSecondary : theme.colors.surfaceMuted }]}
      >
        {image ? (
          <UiImage
            uri={image.image_url}
            accessibilityLabel={translate("merchantProductImagesLabel")}
            aspectRatio={1}
            style={styles.image}
          />
        ) : (
          <Icon name="image" color={theme.colors.muted} size={28} accessibilityHidden />
        )}
      </PressableSurface>

      <View style={styles.postBody}>
        <View style={styles.inputsRow}>
        <View style={styles.inputGroup}>
          <UiText style={[styles.inputLabel, { color: theme.colors.muted }]}>{translate("merchantProductsPriceLabel")}</UiText>
          <TextField
            value={price}
            onChangeText={setPrice}
            keyboardType="number-pad"
            editable={canManageCatalog && !anyBusy}
            accessibilityLabel={translate("merchantProductsPriceLabel")}
            style={[styles.valueInput, { color: theme.colors.foreground, borderColor: (theme.colors.inputBorder), backgroundColor: theme.colors.background }]}
          />
        </View>
        <View style={styles.inputGroup}>
          <UiText style={[styles.inputLabel, { color: theme.colors.muted }]}>{translate("merchantProductsStockLabel")}</UiText>
          <TextField
            value={stock}
            onChangeText={setStock}
            keyboardType="number-pad"
            editable={!anyBusy}
            accessibilityLabel={translate("merchantProductsStockLabel")}
            style={[styles.valueInput, { color: theme.colors.foreground, borderColor: (theme.colors.inputBorder), backgroundColor: theme.colors.background }]}
          />
          <UiText style={[styles.stockHint, { color: theme.colors.subtle }]}>
            {translate("merchantProductsStockHint")}
          </UiText>
        </View>
        </View>

{canManageCatalog ? (
          <>
            <Button label={translate("merchantProductsSave")} onPress={handleSave} loading={busy} disabled={anyBusy} fullWidth />
            <View style={styles.actionsRow}>
              <Button label={offer.is_merchant_hidden ? translate("merchantProductsShow") : translate("merchantProductsHide")} onPress={handleToggleVisibility} disabled={anyBusy} variant="outline" size="sm" fullWidth style={{ flex: 1 }} />
              <Button label={translate("merchantProductEditOpen")} onPress={handleEdit} disabled={anyBusy} variant="ghost" size="sm" fullWidth style={{ flex: 1 }} />
            </View>
          </>
        ) : null}
      </View>

      <MediaViewer
        visible={galleryOpen}
        onRequestClose={() => setGalleryOpen(false)}
        closeLabel={translate("merchantProductCategoryClose")}
      >
        <ScrollView
          horizontal
          contentContainerStyle={styles.galleryImages}
          showsHorizontalScrollIndicator={false}
        >
          {offer.images.map((item) => (
            <UiImage
              key={item.id}
              uri={item.image_url}
              accessibilityLabel={translate("merchantProductImagesLabel")}
              aspectRatio={260 / 300}
              style={styles.galleryImage}
              resizeMode="contain"
            />
          ))}
        </ScrollView>
      </MediaViewer>
    </Card>
  );
});

function MessageScreen({
  theme,
  title,
  label,
  actionLabel,
  onAction,
  loading = false,
  busy = false
}: {
  theme: AppTheme;
  title?: string;
  label?: string;
  actionLabel?: string;
  onAction?: () => void;
  loading?: boolean;
  busy?: boolean;
}) {
  const styles = createStyles(theme);

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[styles.safe, { backgroundColor: theme.colors.background }]}>
      <View style={styles.messageContainer}>
        <AppHeader
          title={translate("merchantProductsTitle")}        />
        {loading ? (
          <View style={{ width: "100%", gap: designTokens.spacing.lg }}>
            {[0, 1, 2].map((item) => <ProductCardSkeleton key={item} style={{ width: "100%", flex: 0 }} />)}
          </View>
        ) : onAction && actionLabel ? (
          <ErrorState title={title ?? label ?? ""} retryLabel={actionLabel} busy={busy} onRetry={onAction} />
        ) : (
          <UiText style={[styles.messageText, { color: theme.colors.foreground }]}>{title ?? label ?? ""}</UiText>
        )}
      </View>
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    safe: { flex: 1 },
    content: { padding: designTokens.spacing.lg, paddingBottom: designTokens.spacing.xxl, gap: designTokens.spacing.md },
    summaryGrid: { flexDirection: "row", gap: designTokens.spacing.sm },
    summaryCard: { flex: 1, minHeight: 84, alignItems: "flex-start", justifyContent: "center", paddingHorizontal: designTokens.spacing.md },
    searchField: { width: "100%" },
    filters: { paddingVertical: designTokens.spacing.xs, paddingEnd: designTokens.spacing.xs },
    filterButton: { minHeight: 42, borderWidth: 1, borderRadius: designTokens.radius.pill, paddingHorizontal: 15, justifyContent: "center", alignItems: "center" },
    filterLabel: { fontSize: designTokens.typography.caption, fontWeight: designTokens.fontWeights.extrabold },
    feedback: { borderWidth: 1, borderRadius: designTokens.radius.sm, padding: designTokens.spacing.md },
    feedbackText: { fontSize: designTokens.typography.caption, lineHeight: 18, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
    emptyCard: { gap: designTokens.spacing.sm, alignItems: "flex-start" },
    emptyTitle: { fontSize: designTokens.typography.body, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
    emptyHint: { fontSize: designTokens.typography.caption, lineHeight: 18, textAlign: "auto" },
    offerGrid: { width: "100%", flexDirection: "column", gap: designTokens.spacing.lg },
    offerGridItem: { width: "100%", minWidth: 0 },
    offerCard: { padding: 0, gap: 0, overflow: "hidden" },
    postHeader: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: designTokens.spacing.sm, padding: designTokens.spacing.md },
    badgeColumn: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: designTokens.spacing.xs },
    productImage: { width: "100%", aspectRatio: 1, borderRadius: 0, overflow: "hidden", alignItems: "center", justifyContent: "center" },
    postBody: { width: "100%", padding: designTokens.spacing.md, gap: designTokens.spacing.md },
    image: { width: "100%", height: "100%" },
    galleryOverlay: { flex: 1, justifyContent: "center", padding: designTokens.spacing.lg },
    galleryCard: { borderWidth: 1, borderRadius: designTokens.radius.md, padding: designTokens.spacing.lg, gap: designTokens.spacing.md },
    galleryHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    galleryTitle: { fontSize: designTokens.typography.body - 1, fontWeight: designTokens.fontWeights.extrabold },
    galleryClose: { fontSize: designTokens.typography.caption, fontWeight: designTokens.fontWeights.extrabold },
    galleryImages: { flexDirection: "row", gap: designTokens.spacing.md, paddingVertical: 4 },
    galleryImage: { width: 260, height: 300, borderRadius: designTokens.radius.sm, backgroundColor: theme.colors.surfaceMuted },
    imageFallback: { fontSize: designTokens.typography.title + 2, fontWeight: designTokens.fontWeights.extrabold },
    productInfo: { flex: 1, minWidth: 0, alignItems: "flex-start", gap: designTokens.spacing.xs },
    productName: { width: "100%", fontSize: designTokens.typography.body - 1, lineHeight: 19, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
    productBrand: { width: "100%", fontSize: designTokens.typography.caption - 1, textAlign: "auto" },
    currentPrice: { fontSize: designTokens.typography.caption + 1, fontWeight: designTokens.fontWeights.extrabold, marginTop: 1 },
    inputsRow: { flexDirection: "row", gap: designTokens.spacing.sm },
    inputGroup: { flex: 1, minWidth: 0, gap: designTokens.spacing.xs },
    inputLabel: { fontSize: designTokens.typography.caption, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
    stockHint: { fontSize: designTokens.typography.caption - 2, lineHeight: 14, textAlign: "auto" },
    valueInput: { width: "100%", minHeight: 42, borderWidth: 1, borderRadius: designTokens.radius.sm, paddingHorizontal: designTokens.spacing.sm, textAlign: "auto", fontSize: designTokens.typography.caption + 1, fontWeight: designTokens.fontWeights.extrabold },
    actionsRow: { flexDirection: "row", gap: designTokens.spacing.sm },
    messageContainer: { flex: 1, padding: designTokens.spacing.lg, justifyContent: "center", gap: designTokens.spacing.lg },
    messageText: { fontSize: designTokens.typography.body - 1, lineHeight: 21, fontWeight: designTokens.fontWeights.extrabold, textAlign: "center" }
  });
}
