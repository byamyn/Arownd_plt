const SIZE_CATEGORIES = new Set(["clothes", "shoes", "kids-clothes", "sportswear"]);
const COLOR_CATEGORIES = new Set([
  "clothes", "shoes", "kids-clothes", "sportswear", "bags",
  "phones", "computers", "gadgets", "phone-accessories",
  "furniture", "decor", "kitchenware", "toys", "sports-gear", "car-accessories"
]);

export function merchantCategorySupportsSizes(category: string): boolean {
  return SIZE_CATEGORIES.has(category.trim());
}

export function merchantCategorySupportsColors(category: string): boolean {
  return COLOR_CATEGORIES.has(category.trim());
}

export type MerchantProductInput = {
  name: string;
  price: number;
  stock_quantity: number;
  category: string;
  brand: string | null;
  description: string | null;
  options: { sizes: string[]; colors: string[] };
};

export function parseMerchantOptionList(value: string): string[] | null {
  const values = value.split(/[،,]/).map((item) => item.trim()).filter(Boolean);
  const unique = [...new Set(values)];

  if (unique.length > 20 || unique.some((item) => item.length > 40)) return null;
  return unique;
}

export type MerchantProductField = "name" | "price" | "stock" | "category" | "brand" | "description" | "sizes" | "colors";
export type MerchantProductFieldError = "required" | "invalid" | "too_long" | "too_large" | "invalid_options";
export type MerchantProductFieldErrors = Partial<Record<MerchantProductField, MerchantProductFieldError>>;

export function getMerchantProductInputErrors(input: { name: string; price: string; stock: string; category: string; brand: string; description: string; sizes: string; colors: string; }): MerchantProductFieldErrors {
  const errors: MerchantProductFieldErrors = {};
  const name = input.name.trim(), priceText = input.price.trim(), stockText = input.stock.trim();
  const price = Number(priceText), stock = Number(stockText);
  const sizes = merchantCategorySupportsSizes(input.category) ? parseMerchantOptionList(input.sizes) : [];
  const colors = merchantCategorySupportsColors(input.category) ? parseMerchantOptionList(input.colors) : [];
  if (!name) errors.name = "required"; else if (name.length < 2 || name.length > 120) errors.name = "too_long";
  if (!priceText) errors.price = "required"; else if (!Number.isSafeInteger(price) || price <= 0) errors.price = "invalid"; else if (price > 50_000_000) errors.price = "too_large";
  if (!stockText) errors.stock = "required"; else if (!Number.isInteger(stock) || stock < 0) errors.stock = "invalid"; else if (stock > 9999) errors.stock = "too_large";
  if (!input.category.trim()) errors.category = "required";
  if (input.brand.trim().length > 80) errors.brand = "too_long";
  if (input.description.trim().length > 3000) errors.description = "too_long";
  if (sizes === null) errors.sizes = "invalid_options";
  if (colors === null) errors.colors = "invalid_options";
  return errors;
}

export function validateMerchantProductInput(input: {
  name: string;
  price: string;
  stock: string;
  category: string;
  brand: string;
  description: string;
  sizes: string;
  colors: string;
}): MerchantProductInput | null {
  const name = input.name.trim();
  const brand = input.brand.trim();
  const description = input.description.trim();
  const price = Number(input.price);
  const stock = Number(input.stock);
  const sizes = merchantCategorySupportsSizes(input.category) ? parseMerchantOptionList(input.sizes) : [];
  const colors = merchantCategorySupportsColors(input.category) ? parseMerchantOptionList(input.colors) : [];

  if (Object.keys(getMerchantProductInputErrors(input)).length > 0) return null;

  return {
    name,
    price,
    stock_quantity: stock,
    category: input.category,
    brand: brand || null,
    description: description || null,
    options: { sizes: sizes ?? [], colors: colors ?? [] }
  };
}


export type MerchantProductCreateErrorKind =
  | "cleanup"
  | "permission"
  | "category"
  | "merchant"
  | "input"
  | "data"
  | "network"
  | "unknown";

export function classifyMerchantProductCreateError(error: unknown): MerchantProductCreateErrorKind {
  const value = error && typeof error === "object"
    ? error as { code?: unknown; message?: unknown }
    : {};
  const code = typeof value.code === "string" ? value.code : "";
  const message = typeof value.message === "string" ? value.message.toLowerCase() : "";
  const combined = message;

  if (combined.includes("cleanup_required")) return "cleanup";
  if (combined.includes("invalid_merchant_product_category")) return "category";
  if (
    combined.includes("merchant_role_required") ||
    combined.includes("merchant_account_required") ||
    combined.includes("merchant_store_not_found") ||
    combined.includes("not_authenticated")
  ) return "merchant";
  if (combined.includes("invalid_merchant_product_input") || combined.includes("invalid_merchant_product_options")) {
    return "input";
  }
  if (code === "42501" || combined.includes("row-level security") || combined.includes("permission denied")) {
    return "permission";
  }
  if (["23503", "23505", "23514", "22P02", "22003"].includes(code)) return "data";
  if (error instanceof TypeError || code === "NETWORK_ERROR" || combined.includes("network request failed")) {
    return "network";
  }
  return "unknown";
}
