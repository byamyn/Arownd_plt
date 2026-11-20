import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useRef, useState, type ComponentRef } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { EmptyState, ErrorState } from "@/components/customer-ui";
import { Button, Icon, IconButton, PriceDisplay, ProductImageGallery, ProductQuantitySelector, ProductVariantSelector, RatingStars, ProductCardSkeleton, Text as UiText } from "@/components/ui";
import { FavoriteButton } from "@/components/favorite-button";
import { chooseBestProductOffer, fetchProductDetails, fetchProductOffers, formatMarketPrice, getOfferVariantOptions } from "@/lib/catalog";
import { BROWSING_CURRENCY_QUERY_KEY, fetchBrowsingCurrencyCode } from "@/lib/country-service";
import { addToCart, CART_QUERY_KEY } from "@/lib/cart";
import { emitCartFly } from "@/lib/cart-fly";
import { fetchApprovedReviews } from "@/lib/reviews";
import { translate, useLanguage } from "@/lib/i18n";
import { ReviewPanel } from "@/components/review-panel";
import { ContentReportAction } from "@/components/content-report-action";
import { designTokens, useAppTheme } from "@/lib/theme";
import { getLocalizedProductCategoryLabel } from "@/lib/locale-data";

export default function ProductDetailsScreen() {
  const { language } = useLanguage();
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const theme = useAppTheme();
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [productInfoExpanded, setProductInfoExpanded] = useState(false);
  const [reviewsExpanded, setReviewsExpanded] = useState(false);
  const imageAnchorRef = useRef<ComponentRef<typeof View>>(null);
  const cartFlyImageRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const browsingCurrency = useQuery({ queryKey: BROWSING_CURRENCY_QUERY_KEY, queryFn: ({ signal }) => fetchBrowsingCurrencyCode(signal), staleTime: 60_000 });
  const addMutation = useMutation({
    mutationFn: addToCart,
    onSuccess: (next) => {
      queryClient.setQueryData(CART_QUERY_KEY, next);
      void queryClient.invalidateQueries({ queryKey: CART_QUERY_KEY });
      imageAnchorRef.current?.measureInWindow((x, y, width, height) => {
        emitCartFly({
          source: { x, y, width, height },
          imageUri: cartFlyImageRef.current
        });
      });
    }
  });
  const product = useQuery({
    queryKey: ["customer-product", productId],
    queryFn: ({ signal }) => fetchProductDetails(productId, signal),
    enabled: Boolean(productId)
  });
  const offers = useQuery({
    queryKey: ["customer-product-offers", productId],
    queryFn: ({ signal }) => fetchProductOffers(productId, signal),
    enabled: Boolean(productId)
  });
  const reviews = useQuery({
    queryKey: ["approved-reviews", "product", productId],
    queryFn: ({ signal }) => fetchApprovedReviews("product", productId, signal),
    enabled: Boolean(productId)
  });

  const sheetOptions = (
    <Stack.Screen options={{
      presentation: "transparentModal",
      animation: "slide_from_bottom",
      contentStyle: { backgroundColor: "transparent" }
    }} />
  );

  if (product.isPending) return (
    <>
      {sheetOptions}
      <View style={styles.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel={translate("back")} onPress={() => router.back()} style={StyleSheet.absoluteFill} />
        <View style={[styles.sheet, { backgroundColor: theme.colors.background }]}>
          <View style={[styles.sheetHandle, { backgroundColor: theme.colors.border }]} />
          <View style={styles.sheetHeader}>
            <IconButton accessibilityLabel={translate("back")} onPress={() => router.back()} icon={<Icon name="chevron-down" size={22} color={theme.colors.foreground} />} />
          </View>
          <ProductCardSkeleton style={{ width: "100%", flex: 0, minHeight: 320 }} />
        </View>
      </View>
    </>
  );
  if (product.isError) {
    return (
      <>
        {sheetOptions}
        <View style={styles.overlay}>
          <Pressable accessibilityRole="button" accessibilityLabel={translate("back")} onPress={() => router.back()} style={StyleSheet.absoluteFill} />
          <View style={[styles.sheet, { backgroundColor: theme.colors.background }]}>
            <View style={[styles.sheetHandle, { backgroundColor: theme.colors.border }]} />
            <View style={styles.sheetHeader}>
              <IconButton accessibilityLabel={translate("back")} onPress={() => router.back()} icon={<Icon name="chevron-down" size={22} color={theme.colors.foreground} />} />
            </View>
            <ErrorState title={translate("catalogLoadError")} retryLabel={translate("retry")} busy={product.isFetching} onRetry={() => void product.refetch()} />
          </View>
        </View>
      </>
    );
  }
  if (!product.data) {
    return (
      <>
        {sheetOptions}
        <View style={styles.overlay}>
          <Pressable accessibilityRole="button" accessibilityLabel={translate("back")} onPress={() => router.back()} style={StyleSheet.absoluteFill} />
          <View style={[styles.sheet, { backgroundColor: theme.colors.background }]}>
            <View style={[styles.sheetHandle, { backgroundColor: theme.colors.border }]} />
            <View style={styles.sheetHeader}>
              <IconButton accessibilityLabel={translate("back")} onPress={() => router.back()} icon={<Icon name="chevron-down" size={22} color={theme.colors.foreground} />} />
            </View>
            <EmptyState title={translate("detailNotFound")} hint={translate("productNoDescription")} />
          </View>
        </View>
      </>
    );
  }

  const productDetails = product.data;
  const productOffers = offers.data ?? [];
  const bestOffer = chooseBestProductOffer(productOffers);
  const selectedOffer = productOffers.find((offer) => offer.id === selectedOfferId) ?? bestOffer;
  const isProductAvailable = Boolean(selectedOffer?.is_available && selectedOffer.stock_quantity > 0);
  const selectedOfferImages = (selectedOffer?.images ?? [])
    .filter((image): image is typeof image & { image_url: string } => typeof image.image_url === "string" && image.image_url.trim().length > 0)
    .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)))
    .map((image) => image.image_url);
  const fallbackImages = productOffers.flatMap((offer) => offer.images)
    .filter((image): image is typeof image & { image_url: string } => typeof image.image_url === "string" && image.image_url.trim().length > 0)
    .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)))
    .map((image) => image.image_url);
  const galleryImages = [...new Set(selectedOfferImages.length > 0 ? selectedOfferImages : fallbackImages)];
  const imageUrl = galleryImages[selectedImageIndex] ?? galleryImages[0] ?? null;
  cartFlyImageRef.current = imageUrl;
  const variants = getOfferVariantOptions(selectedOffer);
  const selectedSize = variants.sizes.includes(size) ? size : variants.sizes[0] ?? "";
  const selectedColor = variants.colors.includes(color) ? color : variants.colors[0] ?? "";
  const canAdd = Boolean(selectedOffer && selectedOffer.is_available && selectedOffer.stock_quantity > 0 && quantity <= selectedOffer.stock_quantity);
  const reviewCount = reviews.data?.length ?? 0;
  const reviewAverage = reviewCount > 0
    ? reviews.data!.reduce((total, review) => total + review.rating, 0) / reviewCount
    : 0;

  return (
    <>
      {sheetOptions}
      <View style={styles.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel={translate("back")} onPress={() => router.back()} style={StyleSheet.absoluteFill} />
        <View style={[styles.sheet, { backgroundColor: theme.colors.background }]}>
          <View style={[styles.sheetHandle, { backgroundColor: theme.colors.border }]} />
          <View style={styles.sheetHeader}>
            <IconButton accessibilityLabel={translate("back")} onPress={() => router.back()} icon={<Icon name="chevron-down" size={22} color={theme.colors.foreground} />} />
          </View>
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={product.isFetching || offers.isFetching || reviews.isFetching} onRefresh={() => { void Promise.all([product.refetch(), offers.refetch(), reviews.refetch()]); }} tintColor={theme.colors.accentOnSurface} />}
          >
      <View ref={imageAnchorRef} collapsable={false} style={styles.heroWrap}>
        {imageUrl ? <ProductImageGallery images={galleryImages} selectedIndex={Math.min(selectedImageIndex, Math.max(0, galleryImages.length - 1))} accessibilityLabel={productDetails.name} onSelect={setSelectedImageIndex} imageStyle={styles.heroImage} /> : <View style={[styles.heroImage, { backgroundColor: theme.colors.surfaceMuted }]}><Icon name="image" size={42} color={theme.colors.subtle} accessibilityHidden /></View>}
        <View style={styles.favoriteOverlay}>
          <FavoriteButton kind="products" id={productId} iconOnly />
        </View>
      </View>
      {galleryImages.length > 0 ? (
        <View style={styles.galleryIndicator}>
          <UiText tone="muted" style={styles.reviewCount}>{selectedImageIndex + 1} / {galleryImages.length}</UiText>
          <View style={styles.galleryDots}>
            {galleryImages.map((image, index) => (
              <View key={image + index} style={[styles.galleryDot, { backgroundColor: index === selectedImageIndex ? theme.colors.foreground : theme.colors.border }]} />
            ))}
          </View>
        </View>
      ) : null}
      <View style={styles.infoSection}>
        <View style={styles.productTitleRow}>
          <UiText weight="700" style={styles.productName}>{productDetails.name}</UiText>
          <View style={[styles.availabilityBadge, { backgroundColor: theme.colors.surfaceMuted }]}>
            <UiText weight="700" style={styles.availabilityStatus}>{translate(isProductAvailable ? "productAvailable" : "productUnavailable")}</UiText>
          </View>
        </View>
        {productDetails.description?.trim() ? <UiText tone="muted" style={styles.description}>{productDetails.description.trim()}</UiText> : null}
        {selectedOffer ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={translate("productSelectedOffer") + ": " + selectedOffer.store.name}
            onPress={() => router.push({ pathname: "/store/[storeId]", params: { storeId: selectedOffer.store.id } })}
            style={styles.storeRow}
          >
            <View style={styles.storeIdentity}>
              <View style={[styles.storeIcon, { backgroundColor: theme.colors.surfaceMuted }]}>
                <Icon name="store" size={18} color={theme.colors.foreground} />
              </View>
              <View style={styles.storeCopy}>
                <UiText weight="700" numberOfLines={1}>{selectedOffer.store.name}</UiText>
              </View>
            </View>
            <Icon name="chevron-left" size={18} color={theme.colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {selectedOffer ? (
        <View style={styles.priceRatingRow}>
          <PriceDisplay value={browsingCurrency.data ? formatMarketPrice(selectedOffer.price, browsingCurrency.data) : "—"} style={styles.priceDisplay} />
          <View style={styles.ratingInfo}>
            <RatingStars value={reviewAverage} size={15} showValue />
            <UiText tone="muted" style={styles.reviewCount}>{reviewCount} · {translate("reviewsTitle")}</UiText>
          </View>
        </View>
      ) : null}

      {selectedOffer ? (
        <View style={styles.purchaseOptions}>
          {variants.colors.length > 0 ? (
            <View style={styles.optionGroup}>
              <UiText style={styles.optionLabel}>{translate("productColorOption")}</UiText>
              <ProductVariantSelector options={variants.colors.map((value) => ({ value, label: value }))} value={selectedColor} onChange={setColor} accessibilityLabel={translate("productColorOption")} display="chips" />
            </View>
          ) : null}
          {variants.sizes.length > 0 ? (
            <View style={styles.optionGroup}>
              <UiText style={styles.optionLabel}>{translate("productSizeOption")}</UiText>
              <ProductVariantSelector options={variants.sizes.map((value) => ({ value, label: value }))} value={selectedSize} onChange={setSize} accessibilityLabel={translate("productSizeOption")} display="chips" />
            </View>
          ) : null}
          <View style={styles.quantityRow}>
            <UiText weight="700" style={styles.optionLabel}>{translate("productQuantity")}</UiText>
            <ProductQuantitySelector value={quantity} max={Math.max(1, Math.min(10, selectedOffer.stock_quantity))} onChange={setQuantity} decreaseLabel={translate("cartDecrease")} increaseLabel={translate("cartIncrease")} disabled={!selectedOffer.is_available || selectedOffer.stock_quantity <= 0} />
          </View>
        </View>
      ) : null}
      <View style={styles.accordion}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: productInfoExpanded }}
          onPress={() => setProductInfoExpanded((current) => !current)}
          style={styles.accordionHeader}
        >
          <UiText weight="700">{translate("productInformation")}</UiText>
          <Icon name={productInfoExpanded ? "minus" : "chevron-down"} size={18} color={theme.colors.muted} />
        </Pressable>
        {productInfoExpanded ? (
          <View style={styles.metadata}>
            {productDetails.brand ? <UiText tone="muted" style={styles.metaText}>{translate("productBrand")}: {productDetails.brand}</UiText> : null}
            {productDetails.category ? <UiText tone="muted" style={styles.metaText}>{translate("productCategory")}: {getLocalizedProductCategoryLabel(productDetails.category, language)}</UiText> : null}
          </View>
        ) : null}
      </View>
      <View style={styles.accordion}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: reviewsExpanded }}
          onPress={() => setReviewsExpanded((current) => !current)}
          style={styles.accordionHeader}
        >
          <UiText weight="700">{translate("reviewsTitle")} ({reviewCount})</UiText>
          <Icon name={reviewsExpanded ? "minus" : "chevron-down"} size={18} color={theme.colors.muted} />
        </Pressable>
        {reviewsExpanded ? <ReviewPanel targetType="product" targetId={productId} /> : null}
      </View>
      <ContentReportAction targetType="product" targetId={productId} />
          </ScrollView>
          {selectedOffer ? (
            <View style={[styles.purchaseFooter, { backgroundColor: theme.colors.background, borderTopColor: theme.colors.border }]}>
              <View style={styles.footerTotal}>
                <UiText tone="muted" style={styles.reviewCount}>{translate("cartSubtotal")}</UiText>
                <PriceDisplay value={browsingCurrency.data ? formatMarketPrice(selectedOffer.price * quantity, browsingCurrency.data) : "—"} />
              </View>
              <View style={styles.footerAction}>
                <Button
                  label={addMutation.isPending ? translate("productAddingToCart") : addMutation.isSuccess ? translate("productAddedToCart") : translate("productAddToCart")}
                  onPress={() => addMutation.mutate({
                    offerId: selectedOffer.id,
                    productId: selectedOffer.product_id,
                    name: product.data?.name ?? selectedOffer.product.name,
                    price: selectedOffer.price,
                    quantity,
                    options: {
                      ...(selectedColor ? { color: selectedColor } : {}),
                      ...(selectedSize ? { size: selectedSize } : {})
                    }
                  })}
                  loading={addMutation.isPending}
                  disabled={!canAdd}
                  fullWidth
                />
              </View>
              {addMutation.isError ? <UiText tone="danger" style={styles.mutationError}>{translate("genericError")}</UiText> : null}
            </View>
          ) : null}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.42)" },
  sheet: { height: "93%", maxHeight: "93%", width: "100%", borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: "hidden", paddingTop: designTokens.spacing.sm },
  sheetHandle: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, marginBottom: designTokens.spacing.xs },
  sheetHeader: { minHeight: 42, paddingHorizontal: designTokens.spacing.xl, alignItems: "flex-start", justifyContent: "center" },
  sheetScroll: { flex: 1 },
  sheetContent: { gap: designTokens.spacing.md, paddingHorizontal: designTokens.spacing.xl, paddingTop: designTokens.spacing.xs, paddingBottom: designTokens.spacing.xl },
  heroWrap: { position: "relative" },
  heroImage: { height: 300, borderRadius: designTokens.radius.lg, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  favoriteOverlay: { position: "absolute", top: designTokens.spacing.md, end: designTokens.spacing.md },
  galleryIndicator: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: designTokens.spacing.xs },
  galleryDots: { flexDirection: "row", alignItems: "center", gap: 5 },
  galleryDot: { width: 6, height: 6, borderRadius: 3 },
  infoSection: { gap: designTokens.spacing.xs, paddingVertical: designTokens.spacing.xs },
  productTitleRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: designTokens.spacing.md },
  productName: { flex: 1, fontSize: designTokens.typography.title - 2, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
  priceDisplay: { justifyContent: "flex-end" },
  availabilityBadge: { alignSelf: "flex-start", borderRadius: designTokens.radius.md, paddingHorizontal: designTokens.spacing.md, paddingVertical: designTokens.spacing.xs },
  availabilityStatus: { fontSize: designTokens.typography.caption + 1, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
  priceRatingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: designTokens.spacing.md, paddingVertical: designTokens.spacing.xs },
  ratingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: designTokens.spacing.md },
  ratingInfo: { flex: 1, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: designTokens.spacing.sm },
  reviewCount: { fontSize: designTokens.typography.caption },
  metadata: { flexDirection: "row", flexWrap: "wrap", gap: designTokens.spacing.md },
  metaText: { fontSize: designTokens.typography.caption + 1, textAlign: "auto" },
  description: { fontSize: designTokens.typography.body - 1, lineHeight: 22, textAlign: "auto" },
  section: { gap: designTokens.spacing.sm },
  sectionTitle: { fontSize: designTokens.typography.subtitle + 1, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
  offerCard: { minHeight: 68, borderRadius: designTokens.radius.md },
  offerCardContent: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: designTokens.spacing.md },
  offerInfo: { flex: 1, alignItems: "flex-start", gap: designTokens.spacing.xs },
  offerStore: { fontSize: designTokens.typography.body, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
  offerPriceDisplay: { justifyContent: "flex-start" },
  purchaseOptions: { gap: designTokens.spacing.md, paddingVertical: designTokens.spacing.xs },
  storeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: designTokens.spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(127,127,127,0.22)", marginBottom: designTokens.spacing.xs },
  storeIdentity: { flex: 1, flexDirection: "row", alignItems: "center", gap: designTokens.spacing.sm },
  storeIcon: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  accordion: { paddingVertical: designTokens.spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(127,127,127,0.22)" },
  accordionHeader: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  storeCopy: { flex: 1, gap: 2 },
  storeVisit: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: designTokens.spacing.sm, paddingStart: designTokens.spacing.sm },
  optionGroup: { gap: designTokens.spacing.sm },
  optionLabel: { fontSize: designTokens.typography.caption + 1, fontWeight: designTokens.fontWeights.extrabold, textAlign: "auto" },
  quantityRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  mutationError: { fontSize: designTokens.typography.caption, textAlign: "auto" },
  purchaseFooter: { flexDirection: "row", alignItems: "center", gap: designTokens.spacing.md, paddingHorizontal: designTokens.spacing.xl, paddingTop: designTokens.spacing.sm, paddingBottom: designTokens.spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  footerTotal: { flex: 1, gap: 2 },
  footerAction: { flex: 1.35 },

});
