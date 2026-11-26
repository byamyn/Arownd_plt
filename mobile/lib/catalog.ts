import { z } from "zod";

import { getSupabaseClient } from "@/lib/supabase";
import { getCurrentLanguage } from "@/lib/i18n";

const ProductSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  rating: z.preprocess((value: unknown) => value == null ? null : Number(value), z.number().nullable()).optional()
}).passthrough();

const StoreSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  logo_url: z.string().nullable().optional(),
  cover_url: z.string().nullable().optional(),
  commune: z.string().nullable().optional(),
  address_line: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  whatsapp: z.string().nullable().optional(),
  instagram_url: z.string().nullable().optional(),
  facebook_url: z.string().nullable().optional(),
  tiktok_url: z.string().nullable().optional(),
  website_url: z.string().nullable().optional(),
  country_code: z.string().length(2).nullable().optional(),
  rating: z.preprocess((value: unknown) => value == null ? null : Number(value), z.number().nullable()).optional(),
  is_verified: z.boolean().optional(),
  opening_hours: z.unknown().optional(),
  latitude: z.preprocess((value: unknown) => value == null ? null : Number(value), z.number().nullable()).optional(),
  longitude: z.preprocess((value: unknown) => value == null ? null : Number(value), z.number().nullable()).optional()
}).passthrough();

const ProductImageSchema = z.object({
  id: z.string().optional(),
  image_url: z.string().nullable(),
  is_primary: z.boolean().optional()
}).passthrough();

const HomeProductSchema = z.object({
  id: z.string(),
  price: z.coerce.number(),
  stock_quantity: z.coerce.number(),
  is_available: z.boolean(),
  product: ProductSummarySchema,
  store: z.object({
    id: z.string(),
    name: z.string(),
    logo_url: z.string().nullable().optional(),
    rating: z.preprocess((value: unknown) => value == null ? null : Number(value), z.number().nullable()).optional()
  }),
  images: z.array(ProductImageSchema).default([])
}).passthrough();

const FeaturedStoreSchema = StoreSummarySchema.extend({
  id: z.string(),
  name: z.string(),
  is_verified: z.boolean()
});

const MapStoreSchema = z.object({
  id: z.string(),
  name: z.string(),
  logo_url: z.string().nullable().optional(),
  commune: z.string().nullable().optional(),
  address_line: z.string().nullable().optional(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  is_verified: z.boolean()
}).passthrough();

const ProductOfferSchema = z.object({
  id: z.string(),
  product_id: z.string(),
  price: z.coerce.number(),
  old_price: z.coerce.number().nullable().optional(),
  stock_quantity: z.coerce.number(),
  is_available: z.boolean(),
  last_confirmed_at: z.string().nullable().optional(),
  options: z.unknown().optional(),
  product: ProductSummarySchema,
  store: StoreSummarySchema,
  images: z.array(ProductImageSchema).default([])
}).passthrough();

export type HomeProduct = z.infer<typeof HomeProductSchema>;
export type FeaturedStore = z.infer<typeof FeaturedStoreSchema>;
export type ProductSummary = z.infer<typeof ProductSummarySchema>;
export type StoreDetails = z.infer<typeof StoreSummarySchema>;
export type ProductOffer = z.infer<typeof ProductOfferSchema>;
export type MapStore = z.infer<typeof MapStoreSchema>;
export type OfferVariantOptions = { sizes: string[]; colors: string[] };

export function getOfferVariantOptions(offer: ProductOffer | null | undefined): OfferVariantOptions {
  const raw = offer?.options;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { sizes: [], colors: [] };
  const options = raw as Record<string, unknown>;
  const toValues = (value: unknown): string[] => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  return { sizes: toValues(options.sizes), colors: toValues(options.colors) };
}

export async function fetchOffersByIds(ids: string[], signal?: AbortSignal): Promise<ProductOffer[]> {
  const uniqueIds = [...new Set(ids.filter((id) => id.length > 0))];
  if (uniqueIds.length === 0) return [];
  let request = getSupabaseClient()
    .from("store_offers")
    .select("id, product_id, price, old_price, stock_quantity, is_available, last_confirmed_at, options, product:products!inner(id, name, description, category, brand), store:stores!inner(id, name, logo_url, commune, address_line, rating, is_verified), images:product_images(image_url, is_primary)")
    .in("id", uniqueIds);
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return ProductOfferSchema.array().parse(data as unknown);
}

export async function fetchHomeProducts(signal?: AbortSignal): Promise<HomeProduct[]> {
  let request = getSupabaseClient()
    .from("store_offers")
    .select("id, price, stock_quantity, is_available, product:products!inner(id, name, description, category, brand, rating), store:stores!inner(id, name, logo_url, rating), images:product_images(image_url, is_primary)")
    .eq("is_available", true)
    .gt("stock_quantity", 0)
    .order("created_at", { ascending: false })
    .limit(60);
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;

  if (error) throw error;

  const products = HomeProductSchema.array().parse(data as unknown);
  const productsByStore = new Map<string, HomeProduct[]>();

  for (const product of products) {
    const storeProducts = productsByStore.get(product.store.id) ?? [];
    storeProducts.push(product);
    productsByStore.set(product.store.id, storeProducts);
  }

  const balancedProducts: HomeProduct[] = [];
  const storeQueues = [...productsByStore.values()];

  while (true) {
    let hasRemainingProducts = false;

    for (const storeQueue of storeQueues) {
      const nextProduct = storeQueue.shift();
      if (!nextProduct) continue;

      balancedProducts.push(nextProduct);
      hasRemainingProducts = true;
    }

    if (!hasRemainingProducts) break;
  }

  return balancedProducts;
}

export type MapStoreViewport = {
  west: number;
  south: number;
  east: number;
  north: number;
  centerLatitude: number;
  centerLongitude: number;
};

export async function fetchMapStoresInBounds(
  viewport: MapStoreViewport,
  countryCode: string,
  includeStoreId?: string | null,
  signal?: AbortSignal
): Promise<MapStore[]> {
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error("INVALID_BROWSING_COUNTRY");

  const pageSize = 1000;
  const storesById = new Map<string, MapStore>();
  let offset = 0;

  while (true) {
    let request = getSupabaseClient().rpc("fetch_map_stores_in_view", {
      p_west: viewport.west,
      p_south: viewport.south,
      p_east: viewport.east,
      p_north: viewport.north,
      p_center_lat: viewport.centerLatitude,
      p_center_long: viewport.centerLongitude,
      p_include_store_id: includeStoreId ?? null,
      p_limit: pageSize,
      p_country_code: countryCode,
      p_offset: offset
    });
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;

    if (error) throw error;
    const page = MapStoreSchema.array().parse(data as unknown);
    for (const store of page) storesById.set(store.id, store);

    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return [...storesById.values()];
}

export async function fetchFeaturedStores(signal?: AbortSignal): Promise<FeaturedStore[]> {
  let request = getSupabaseClient()
    .from("stores")
    .select("id, name, description, logo_url, commune, rating, is_verified")
    .eq("is_verified", true)
    .order("rating", { ascending: false })
    .limit(6);
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;

  if (error) throw error;
  return FeaturedStoreSchema.array().parse(data as unknown);
}


export async function fetchVerifiedStoresByRegion(countryCode: string, regionId: number, signal?: AbortSignal): Promise<FeaturedStore[]> {
  if (!/^[A-Z]{2}$/.test(countryCode) || !Number.isInteger(regionId) || regionId <= 0) throw new Error("invalid_store_region");
  let request = getSupabaseClient()
    .from("stores")
    .select("id, name, description, logo_url, commune, rating, is_verified, latitude, longitude")
    .eq("country_code", countryCode)
    .eq("region_id", regionId)
    .eq("is_verified", true)
    .order("rating", { ascending: false });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return FeaturedStoreSchema.array().parse(data as unknown);
}

export function getCategoryFilterIds(category: string): readonly string[] {
  return [category];
}

export async function searchCatalogProducts(query: string, category?: string, signal?: AbortSignal): Promise<HomeProduct[]> {
  const normalized = query.trim().replace(/[%,()]/g, " ");
  let request = getSupabaseClient()
    .from("store_offers")
    .select("id, price, stock_quantity, is_available, product:products!inner(id, name, category, brand), store:stores!inner(id, name), images:product_images(image_url, is_primary)")
    .eq("is_available", true)
    .gt("stock_quantity", 0);

  if (normalized) request = request.or("name.ilike.%" + normalized + "%,brand.ilike.%" + normalized + "%", { referencedTable: "products" });
  if (category) request = request.in("product.category", [...getCategoryFilterIds(category)]);

  request = request.order("created_at", { ascending: false }).limit(40);
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;

  if (error) throw error;
  return HomeProductSchema.array().parse(data as unknown);
}

export async function searchCatalogStores(query: string, signal?: AbortSignal): Promise<FeaturedStore[]> {
  const normalized = query.trim().replace(/[%,().]/g, " ").replace(/\\s+/g, " ");
  if (!normalized) return [];

  let request = getSupabaseClient()
    .from("stores")
    .select("id, name, description, logo_url, commune, rating, is_verified")
    .or("name.ilike.%"+normalized+"%,description.ilike.%"+normalized+"%")
    .order("name", { ascending: true })
    .limit(30);
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;

  if (error) throw error;
  return FeaturedStoreSchema.array().parse(data as unknown);
}

export async function fetchProductDetails(productId: string, signal?: AbortSignal): Promise<ProductSummary | null> {
  let request = getSupabaseClient()
    .from("products")
    .select("id, name, description, category, brand")
    .eq("id", productId);
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request.maybeSingle();

  if (error) throw error;
  return data ? ProductSummarySchema.parse(data as unknown) : null;
}

export async function fetchProductOffers(productId: string, signal?: AbortSignal): Promise<ProductOffer[]> {
  let request = getSupabaseClient()
    .from("store_offers")
    .select("id, product_id, price, old_price, stock_quantity, is_available, last_confirmed_at, options, product:products!inner(id, name, description, category, brand), store:stores!inner(id, name, logo_url, commune, address_line, rating, is_verified, phone, whatsapp), images:product_images(image_url, is_primary)")
    .eq("product_id", productId)
    .order("price", { ascending: true });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;

  if (error) throw error;
  return ProductOfferSchema.array().parse(data as unknown);
}

export async function fetchStoreDetails(storeId: string, signal?: AbortSignal): Promise<StoreDetails | null> {
  let request = getSupabaseClient()
    .from("stores")
    .select("id, name, slug, description, logo_url, cover_url, commune, address_line, phone, whatsapp, instagram_url, facebook_url, tiktok_url, website_url, country_code, rating, is_verified, opening_hours, latitude, longitude")
    .eq("id", storeId);
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request.maybeSingle();

  if (error) throw error;
  return data ? StoreSummarySchema.parse(data as unknown) : null;
}

export async function fetchStoreOffers(storeId: string, signal?: AbortSignal): Promise<HomeProduct[]> {
  let request = getSupabaseClient()
    .from("store_offers")
    .select("id, price, stock_quantity, is_available, product:products!inner(id, name, category, brand), store:stores!inner(id, name), images:product_images(image_url, is_primary)")
    .eq("store_id", storeId)
    .eq("is_available", true)
    .gt("stock_quantity", 0)
    .order("created_at", { ascending: false })
    .limit(60);
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;

  if (error) throw error;
  return HomeProductSchema.array().parse(data as unknown);
}

export function getPrimaryImage(product: HomeProduct | ProductOffer): string | null {
  const image = product.images.find((item) => item.is_primary) ?? product.images[0];
  return image?.image_url ?? null;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(getCurrentLanguage() === "ar" ? "ar-DZ-u-nu-latn" : "en-DZ-u-nu-latn", {
    maximumFractionDigits: 2
  }).format(value);
}

const CURRENCY_REGIONS: Record<string, string> = {
  DZD: "DZ",
  MAD: "MA",
  EGP: "EG",
  SAR: "SA",
  AED: "AE"
};

export function formatMarketPrice(amount: number, currencyCode: string): string {
  const normalizedCurrency = currencyCode.toUpperCase();
  const region = CURRENCY_REGIONS[normalizedCurrency];
  if (!region) return `${formatNumber(amount)} ${normalizedCurrency}`;

  const language = getCurrentLanguage() === "ar" ? "ar" : "en";
  const formatter = new Intl.NumberFormat(`${language}-${region}-u-nu-latn`, {
    style: "currency",
    currency: normalizedCurrency,
    minimumFractionDigits: 0,
    maximumFractionDigits: normalizedCurrency === "DZD" ? 0 : 2
  });
  return formatter.formatToParts(amount)
    .map((part) => part.type === "currency" ? part.value.replace(/\./g, "") : part.value)
    .join("");
}

export function formatDZD(amount: number): string {
  const formatter = new Intl.NumberFormat(getCurrentLanguage() === "ar" ? "ar-DZ-u-nu-latn" : "en-DZ-u-nu-latn", {
    style: "currency",
    currency: "DZD",
    maximumFractionDigits: 0
  });
  return formatter.formatToParts(amount)
    .map((part) => part.type === "currency" ? part.value.replace(/\./g, "") : part.value)
    .join("");
}

export function chooseBestProductOffer(offers: ProductOffer[]): ProductOffer | null {
  const available = offers.filter((offer) => offer.is_available && offer.stock_quantity > 0);
  const candidates = available.length > 0 ? available : offers;
  return candidates.reduce<ProductOffer | null>(
    (best, offer) => best === null || offer.price < best.price ? offer : best,
    null
  );
}
