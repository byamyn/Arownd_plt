import type { Language } from "@/lib/i18n";

const CATEGORY_NAMES_EN: Record<string, string> = {
  fashion: "Fashion & Style",
  electronics: "Technology & Electronics",
  beauty: "Beauty & Care",
  home: "Home & Furniture",
  misc: "Miscellaneous Products"
};

const PRODUCT_CATEGORY_NAMES_AR: Record<string, string> = {
  fashion: "الأزياء والأناقة",
  electronics: "التكنولوجيا والأجهزة الإلكترونية",
  beauty: "الجمال والعناية",
  home: "المنزل والأثاث",
  misc: "مستلزمات ومنتجات متنوعة"
};

export function getLocalizedWilayaLabel(_id: number, fallback: string, language: Language, nameFr?: string | null): string {
  if (language === "ar") return fallback;
  return nameFr?.trim() || fallback;
}

export function getLocalizedMerchantCategoryLabel(
  id: string,
  fallback: string,
  language: Language
): string {
  if (language === "ar") return fallback;
  return CATEGORY_NAMES_EN[id] ?? fallback;
}

export function getLocalizedProductCategoryLabel(id: string, language: Language): string {
  const normalizedId = id.trim();
  if (language === "ar") return PRODUCT_CATEGORY_NAMES_AR[normalizedId] ?? normalizedId;
  return CATEGORY_NAMES_EN[normalizedId] ?? normalizedId;
}
