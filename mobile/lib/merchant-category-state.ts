import type { MerchantCategory } from "@/lib/merchant";

export type MerchantCategoryGroup = {
  parent: MerchantCategory;
  children: MerchantCategory[];
};

export function groupMerchantCategories(
  categories: MerchantCategory[]
): MerchantCategoryGroup[] {
  return categories
    .filter((category) => category.parentId === null)
    .map((parent) => ({ parent, children: [] }));
}

export function getSelectableMerchantCategories(
  groups: MerchantCategoryGroup[]
): MerchantCategory[] {
  return groups.map((group) => group.parent);
}
