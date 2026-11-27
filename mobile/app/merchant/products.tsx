import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { memo, useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  RefreshableScrollView,
  Button,
  ErrorState,
  FilterBar,
  FilterChip,
  Icon,
  Image as UiImage,
  ProductCardSkeleton,
  MediaViewer,
  MerchantMetricCard,
  MerchantStatusBadge,
  PressableSurface,
  SearchField,
  Text as UiText
} from "@/components/ui";
import { MerchantStudioHeader } from "@/components/merchant-studio-header";
import { fetchMerchantAccess } from "@/lib/merchant";
import {
  fetchMerchantProductOffer,
  fetchMerchantProducts,
  setMerchantProductVisibility
} from "@/lib/merchant-products";
import {
  filterMerchantProducts,
  getMerchantInventoryLevel,
  getMerchantInventorySummary,
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
    enabled: ready && canManageCatalog,
    retry: false
  });

  const allOffers = products.data ?? EMPTY_MERCHANT_PRODUCTS;
  const summary = useMemo(() => getMerchantInventorySummary(allOffers), [allOffers]);
  const visibleOffers = useMemo(
    () => filterMerchantProducts(allOffers, search, filter),
    [allOffers, search, filter]
  );

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
  if (access.data.teamRole === "staff") return <Redirect href="/merchant/orders" />;
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
      <RefreshableScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshing={access.isFetching || products.isFetching}
        onRefresh={() => { void Promise.all([access.refetch(), products.refetch()]); }}
      >
        <MerchantStudioHeader
          sectionTitle={translate("merchantProductsTitle")}
          onSettingsPress={() => router.push("/merchant/account-settings")}
        />

        <View style={styles.summaryGrid}>
          <MerchantMetricCard label={translate("merchantProductsSummaryTotal")} value={String(summary.total)} style={styles.summaryCard} />
          <MerchantMetricCard label={translate("merchantProductsSummaryLow")} value={String(summary.low)} valueTone="warning" style={styles.summaryCard} />
          <MerchantMetricCard label={translate("merchantProductsSummaryOut")} value={String(summary.out)} valueTone="danger" style={styles.summaryCard} />
        </View>

        {canManageCatalog ? (
          <Button
            label={translate("merchantProductCreateOpen")}
            onPress={() => router.push("/merchant/products/new")}
            fullWidth
          />
        ) : null}

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
          <View style={styles.emptyState}>
            <UiText style={[styles.emptyTitle, { color: theme.colors.foreground }]}>{translate("merchantProductsEmpty")}</UiText>
            <UiText style={[styles.emptyHint, { color: theme.colors.muted }]}>{translate("merchantProductsEmptyHint")}</UiText>
          </View>
        ) : visibleOffers.length === 0 ? (
          <View style={styles.emptyState}>
            <UiText style={[styles.emptyTitle, { color: theme.colors.foreground }]}>{translate("merchantProductsNoResults")}</UiText>
          </View>
        ) : (
          <View style={styles.productList}>
            {visibleOffers.map((offer) => (
              <MerchantProductRow
                key={offer.id}
                offer={offer}
                theme={theme}
                busy={busyOfferId === offer.id}
                anyBusy={busyOfferId !== null}
                canManageCatalog={canManageCatalog}
                onToggleVisibility={toggleVisibility}
                onEdit={editOffer}
              />
            ))}
          </View>
        )}
      </RefreshableScrollView>
    </SafeAreaView>
  );
}

const MerchantProductRow = memo(function MerchantProductRow({
  offer,
  theme,
  busy,
  anyBusy,
  canManageCatalog,
  onToggleVisibility,
  onEdit
}: {
  offer: MerchantProductOffer;
  theme: AppTheme;
  busy: boolean;
  anyBusy: boolean;
  canManageCatalog: boolean;
  onToggleVisibility: (offerId: string, isMerchantHidden: boolean) => void;
  onEdit: (offerId: string) => void;
}) {
  const styles = createStyles(theme);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const image = offer.images.find((item) => item.is_primary) ?? offer.images[0] ?? null;
  const inventoryLevel = getMerchantInventoryLevel(offer.stock_quantity);
  const inventoryLabel = inventoryLevel === "out"
    ? translate("merchantProductsOut")
    : inventoryLevel === "low"
      ? translate("merchantProductsLow")
      : translate("merchantProductsAvailable");

  const openEditor = useCallback(() => onEdit(offer.id), [onEdit, offer.id]);
  const toggleVisibility = useCallback(
    () => onToggleVisibility(offer.id, offer.is_merchant_hidden),
    [onToggleVisibility, offer.id, offer.is_merchant_hidden]
  );

  return (
    <View style={styles.productRow}>
      <PressableSurface
        accessibilityRole={image ? "button" : undefined}
        accessibilityLabel={translate("merchantProductImagesLabel")}
        disabled={!image}
        onPress={() => setGalleryOpen(true)}
        style={[styles.productThumbnail, { backgroundColor: theme.mode === "dark" ? theme.colors.surfaceSecondary : theme.colors.surfaceMuted }]}
      >
        {image ? (
          <UiImage
            uri={image.image_url}
            accessibilityLabel={translate("merchantProductImagesLabel")}
            aspectRatio={1}
            style={styles.thumbnailImage}
          />
        ) : (
          <Icon name="image" color={theme.colors.muted} size={24} accessibilityHidden />
        )}
      </PressableSurface>

      <PressableSurface
        accessibilityRole="button"
        accessibilityLabel={offer.product.name}
        onPress={openEditor}
        style={styles.productDetails}
      >
        <UiText style={[styles.productName, { color: theme.colors.foreground }]} numberOfLines={2}>
          {offer.product.name}
        </UiText>
        {offer.product.brand ? (
          <UiText style={[styles.productBrand, { color: theme.colors.muted }]} numberOfLines={1}>
            {offer.product.brand}
          </UiText>
        ) : null}
        <UiText style={[styles.productPrice, { color: theme.colors.foreground }]}>
          {offer.price.toLocaleString()} دج
        </UiText>
        <View style={styles.metadataRow}>
          <MerchantStatusBadge
            label={inventoryLabel}
            tone={inventoryLevel === "out" ? "danger" : inventoryLevel === "low" ? "warning" : "success"}
          />
          <UiText style={[styles.stockText, { color: theme.colors.muted }]}>
            {translate("merchantProductsStockLabel")}: {offer.stock_quantity}
          </UiText>
          {offer.is_merchant_hidden ? (
            <MerchantStatusBadge label={translate("merchantProductsHidden")} tone="neutral" />
          ) : null}
        </View>
      </PressableSurface>

      {canManageCatalog ? (
        <View style={styles.rowActions}>
          <PressableSurface
            accessibilityRole="button"
            accessibilityLabel={offer.is_merchant_hidden ? translate("merchantProductsShow") : translate("merchantProductsHide")}
            accessibilityState={{ disabled: anyBusy, busy }}
            disabled={anyBusy}
            onPress={toggleVisibility}
            style={[styles.iconAction, { opacity: anyBusy ? 0.5 : 1 }]}
          >
            {busy ? (
              <Icon name="loader-circle" color={theme.colors.muted} size={19} accessibilityHidden />
            ) : (
              <Icon
                name={offer.is_merchant_hidden ? "eye" : "eye-off"}
                color={theme.colors.muted}
                size={19}
                accessibilityHidden
              />
            )}
          </PressableSurface>
          <PressableSurface
            accessibilityRole="button"
            accessibilityLabel={translate("merchantProductEditOpen")}
            onPress={openEditor}
            style={styles.iconAction}
          >
            <Icon name="pencil" color={theme.colors.muted} size={18} accessibilityHidden />
          </PressableSurface>
        </View>
      ) : (
        <Icon name="chevron-left" color={theme.colors.subtle} size={18} accessibilityHidden />
      )}

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
    </View>
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
        <MerchantStudioHeader sectionTitle={translate("merchantProductsTitle")} onSettingsPress={() => router.push("/merchant/account-settings")} />
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
    feedback: { borderWidth: 1, borderRadius: designTokens.radius.sm, padding: designTokens.spacing.md },
    feedbackText: { fontSize: designTokens.typography.caption, lineHeight: 18, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
    emptyState: { paddingVertical: designTokens.spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.divider, gap: designTokens.spacing.sm, alignItems: "flex-start" },
    emptyTitle: { fontSize: designTokens.typography.body, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
    emptyHint: { fontSize: designTokens.typography.caption, lineHeight: 18, textAlign: "auto" },
    productList: { width: "100%" },
    productRow: {
      width: "100%",
      minHeight: 104,
      flexDirection: "row",
      alignItems: "center",
      gap: designTokens.spacing.md,
      paddingVertical: designTokens.spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.divider
    },
    productThumbnail: {
      width: 76,
      height: 76,
      borderRadius: designTokens.radius.md,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center"
    },
    thumbnailImage: { width: "100%", height: "100%" },
    productDetails: { flex: 1, minWidth: 0, alignItems: "flex-start", gap: 4 },
    productName: { width: "100%", fontSize: designTokens.typography.body - 1, lineHeight: 19, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
    productBrand: { width: "100%", fontSize: designTokens.typography.caption - 1, textAlign: "auto" },
    productPrice: { fontSize: designTokens.typography.caption + 1, fontWeight: designTokens.fontWeights.extrabold },
    metadataRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: designTokens.spacing.xs, marginTop: 2 },
    stockText: { fontSize: designTokens.typography.caption - 2 },
    rowActions: { alignItems: "center", justifyContent: "center", gap: designTokens.spacing.xs },
    iconAction: { width: 36, height: 36, borderRadius: designTokens.radius.pill, alignItems: "center", justifyContent: "center" },
    galleryImages: { flexDirection: "row", gap: designTokens.spacing.md, paddingVertical: 4 },
    galleryImage: { width: 260, height: 300, borderRadius: designTokens.radius.sm, backgroundColor: theme.colors.surfaceMuted },
    messageContainer: { flex: 1, padding: designTokens.spacing.lg, justifyContent: "center", gap: designTokens.spacing.lg },
    messageText: { fontSize: designTokens.typography.body - 1, lineHeight: 21, fontWeight: designTokens.fontWeights.extrabold, textAlign: "center" }
  });
}
