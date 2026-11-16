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

  if (
    name.length < 2 ||
    name.length > 120 ||
    !input.price.trim() ||
    !Number.isSafeInteger(price) ||
    price <= 0 ||
    price > 50_000_000 ||
    !input.stock.trim() ||
    !Number.isInteger(stock) ||
    stock < 0 ||
    stock > 9999 ||
    !input.category.trim() ||
    brand.length > 80 ||
    description.length > 3000 ||
    sizes === null ||
    colors === null
  ) {
    return null;
  }

  return {
    name,
    price,
    stock_quantity: stock,
    category: input.category,
    brand: brand || null,
    description: description || null,
    options: { sizes, colors }
  };
}
