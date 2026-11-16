import { describe, expect, it } from "vitest";

import {
  createStoreSlug,
  merchantStoreErrorKey,
  merchantStoreSchema
} from "@/lib/merchant-validation";

const validStore = {
  storeName: "متجر النخبة",
  phone: "0550123456",
  regionId: 16,
  secondaryRegionId: null,
  commune: "باب الزوار",
  addressLine: "شارع الاستقلال، الجزائر",
  open: "09:00",
  close: "18:00"
};

describe("merchantStoreSchema", () => {
  it("accepts the simplified store profile without a category", () => {
    expect(merchantStoreSchema.safeParse(validStore).success).toBe(true);
  });

  it("requires a primary region", () => {
    expect(merchantStoreSchema.safeParse({ ...validStore, regionId: null }).success).toBe(false);
  });

  it("rejects invalid phone numbers and invalid time formats", () => {
    expect(merchantStoreSchema.safeParse({
      ...validStore,
      phone: "12",
      close: "8am"
    }).success).toBe(false);
  });

  it("accepts Arabic-Indic digits in the phone field", () => {
    expect(merchantStoreSchema.safeParse({
      ...validStore,
      phone: "٠٥٥٠ ١٢٣ ٤٥٦"
    }).success).toBe(true);
  });

  it("accepts a category when supplied but does not require one", () => {
    expect(merchantStoreSchema.safeParse({ ...validStore, category: "fashion" }).success).toBe(true);
  });
});

describe("merchant store helpers", () => {
  it("creates a URL-safe slug while retaining Arabic letters", () => {
    expect(createStoreSlug("متجر النخبة", "a1b2c3")).toBe("متجر-النخبة-a1b2c3");
  });

  it("maps known backend errors to translation keys", () => {
    expect(merchantStoreErrorKey(new Error("store_already_exists"))).toBe("merchantErrorStoreExists");
    expect(merchantStoreErrorKey(new Error("secondary_region_required"))).toBe("merchantValidationSecondaryRegionRequired");
    expect(merchantStoreErrorKey(new Error("invalid_country_phone"))).toBe("merchantValidationPhone");
    expect(merchantStoreErrorKey(new Error("invalid_phone"))).toBe("merchantValidationPhone");
    expect(merchantStoreErrorKey(new Error("unexpected"))).toBe("merchantErrorGeneric");
  });
});
