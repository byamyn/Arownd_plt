import { describe, expect, it } from "vitest";

import {
  parseMerchantOptionList,
  validateMerchantProductInput
} from "@/lib/merchant-product-create-state";

const validInput = {
  name: "قميص قطني",
  price: "2500",
  stock: "12",
  category: "clothes",
  brand: "Arownd",
  description: "وصف المنتج",
  sizes: "S, M، L",
  colors: "أسود, أبيض"
};

describe("parseMerchantOptionList", () => {
  it("splits Arabic and English commas, trims values, and removes duplicates", () => {
    expect(parseMerchantOptionList(" S, M، L, S ")).toEqual(["S", "M", "L"]);
  });

  it("rejects more than twenty values or values longer than forty characters", () => {
    expect(parseMerchantOptionList(Array.from({ length: 21 }, (_, index) => String(index)).join(","))).toBeNull();
    expect(parseMerchantOptionList("x".repeat(41))).toBeNull();
  });
});

describe("validateMerchantProductInput", () => {
  it("normalizes a valid product and its variant labels", () => {
    expect(validateMerchantProductInput(validInput)).toEqual({
      name: "قميص قطني",
      price: 2500,
      stock_quantity: 12,
      category: "clothes",
      brand: "Arownd",
      description: "وصف المنتج",
      options: {
        sizes: ["S", "M", "L"],
        colors: ["أسود", "أبيض"]
      }
    });
  });

  it("does not require or save sizes for unrelated categories", () => {
    const result = validateMerchantProductInput({
      ...validInput,
      category: "phones",
      sizes: "",
      colors: "أسود، أبيض"
    });
    expect(result?.options).toEqual({ sizes: [], colors: ["أسود", "أبيض"] });
  });

  it("does not show or save size and color options for food and digital categories", () => {
    for (const category of ["groceries", "digital-services", "books"]) {
      const result = validateMerchantProductInput({
        ...validInput,
        category,
        sizes: "",
        colors: ""
      });
      expect(result?.options).toEqual({ sizes: [], colors: [] });
    }
  });

  it("keeps sizes and colors for clothing categories", () => {
    expect(validateMerchantProductInput(validInput)?.options).toEqual({
      sizes: ["S", "M", "L"],
      colors: ["أسود", "أبيض"]
    });
  });

  it("allows zero stock but rejects invalid price, stock, and category", () => {
    expect(validateMerchantProductInput({ ...validInput, stock: "0" })?.stock_quantity).toBe(0);
    expect(validateMerchantProductInput({ ...validInput, price: "0" })).toBeNull();
    expect(validateMerchantProductInput({ ...validInput, price: "1.5" })).toBeNull();
    expect(validateMerchantProductInput({ ...validInput, stock: "10000" })).toBeNull();
    expect(validateMerchantProductInput({ ...validInput, category: "" })).toBeNull();
  });

  it("rejects empty or oversized names and oversized optional fields", () => {
    expect(validateMerchantProductInput({ ...validInput, name: " " })).toBeNull();
    expect(validateMerchantProductInput({ ...validInput, name: "x".repeat(121) })).toBeNull();
    expect(validateMerchantProductInput({ ...validInput, brand: "x".repeat(81) })).toBeNull();
    expect(validateMerchantProductInput({ ...validInput, description: "x".repeat(3001) })).toBeNull();
  });
});


describe("classifyMerchantProductCreateError", () => {
  it("classifies cleanup failures before generic permission errors", async () => {
    const { classifyMerchantProductCreateError } = await import("@/lib/merchant-product-create-state");
    expect(classifyMerchantProductCreateError(new Error("product_creation_failed_storage_cleanup_required"))).toBe("cleanup");
  });

  it("maps known database validation and authorization failures", async () => {
    const { classifyMerchantProductCreateError } = await import("@/lib/merchant-product-create-state");
    expect(classifyMerchantProductCreateError(new Error("invalid_merchant_product_category"))).toBe("category");
    expect(classifyMerchantProductCreateError(new Error("merchant_role_required"))).toBe("merchant");
    expect(classifyMerchantProductCreateError({ code: "42501", message: "permission denied" })).toBe("permission");
    expect(classifyMerchantProductCreateError({ code: "23503", message: "foreign key violation" })).toBe("data");
    expect(classifyMerchantProductCreateError(new Error("invalid_merchant_product_input"))).toBe("input");
  });

  it("does not expose unrecognized backend messages as a classification", async () => {
    const { classifyMerchantProductCreateError } = await import("@/lib/merchant-product-create-state");
    expect(classifyMerchantProductCreateError(new Error("private database detail"))).toBe("unknown");
  });
});
