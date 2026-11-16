import { describe, expect, it } from "vitest";

import {
  getSelectableMerchantCategories,
  groupMerchantCategories
} from "@/lib/merchant-category-state";
import type { MerchantCategory } from "@/lib/merchant";

const categories: MerchantCategory[] = [
  { id: "fashion", parentId: null, label: "الأزياء والأناقة", emoji: "👗" },
  { id: "electronics", parentId: null, label: "التكنولوجيا والأجهزة الإلكترونية", emoji: "📱" },
  { id: "beauty", parentId: null, label: "الجمال والعناية", emoji: "✨" },
  { id: "home", parentId: null, label: "المنزل والأثاث", emoji: "🏠" },
  { id: "misc", parentId: null, label: "مستلزمات ومنتجات متنوعة", emoji: "🛍️" },
  { id: "old-child", parentId: "fashion", label: "فئة فرعية قديمة", emoji: "👕" }
];

describe("marketplace main categories", () => {
  it("returns only root categories and preserves their order", () => {
    expect(groupMerchantCategories(categories)).toEqual(
      categories.slice(0, 5).map((parent) => ({ parent, children: [] }))
    );
  });

  it("makes only the five root categories selectable", () => {
    const groups = groupMerchantCategories(categories);
    expect(getSelectableMerchantCategories(groups).map((category) => category.id)).toEqual([
      "fashion",
      "electronics",
      "beauty",
      "home",
      "misc"
    ]);
  });

  it("returns an empty list for an empty category response", () => {
    expect(groupMerchantCategories([])).toEqual([]);
    expect(getSelectableMerchantCategories([])).toEqual([]);
  });
});
