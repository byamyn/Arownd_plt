import { describe, expect, it } from "vitest";
import { MerchantStoreSettingsSchema } from "@/lib/merchant-store-settings-state";

const valid = {
  name: "متجر الاختبار",
  region_id: 9,
  secondary_region_id: null,
  logo_url: "",
  cover_url: "",
  description: "",
  phone: "0550123456",
  whatsapp: "",
  commune: "البليدة",
  address_line: "شارع الاستقلال رقم 10",
  opening_hours: { open: "09:00", close: "20:00", closed_days: [5] },
  instagram_url: "",
  facebook_url: "",
  tiktok_url: "",
  website_url: ""
};

describe("MerchantStoreSettingsSchema", () => {
  it("accepts valid store settings", () => {
    expect(MerchantStoreSettingsSchema.safeParse(valid).success).toBe(true);
  });

  it("requires a valid primary region identifier", () => {
    expect(MerchantStoreSettingsSchema.safeParse({ ...valid, region_id: 0 }).success).toBe(false);
    expect(MerchantStoreSettingsSchema.safeParse({ ...valid, region_id: 9 }).success).toBe(true);
  });

  it("accepts valid map coordinates and rejects out-of-range or incomplete coordinates", () => {
    expect(MerchantStoreSettingsSchema.safeParse({
      ...valid,
      latitude: 36.75,
      longitude: 3.05
    }).success).toBe(true);
    expect(MerchantStoreSettingsSchema.safeParse({
      ...valid,
      latitude: 91,
      longitude: 3.05
    }).success).toBe(false);
    expect(MerchantStoreSettingsSchema.safeParse({
      ...valid,
      latitude: 36.75,
      longitude: null
    }).success).toBe(false);
    expect(MerchantStoreSettingsSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects unsafe social URLs, invalid opening times and duplicate closing days", () => {
    expect(MerchantStoreSettingsSchema.safeParse({
      ...valid,
      instagram_url: "javascript:alert(1)"
    }).success).toBe(false);
    expect(MerchantStoreSettingsSchema.safeParse({
      ...valid,
      instagram_url: "https://"
    }).success).toBe(false);
    expect(MerchantStoreSettingsSchema.safeParse({
      ...valid,
      facebook_url: "http://facebook.com/example"
    }).success).toBe(false);
    expect(MerchantStoreSettingsSchema.safeParse({
      ...valid,
      instagram_url: "https://instagram.com/example",
      facebook_url: "https://facebook.com/example",
      tiktok_url: "https://www.tiktok.com/@example",
      website_url: "https://example.com"
    }).success).toBe(true);
    expect(MerchantStoreSettingsSchema.safeParse({ ...valid, tiktok_url: "javascript:alert(1)" }).success).toBe(false);
    expect(MerchantStoreSettingsSchema.safeParse({ ...valid, website_url: "http://example.com" }).success).toBe(false);
    expect(MerchantStoreSettingsSchema.safeParse({
      ...valid,
      opening_hours: { ...valid.opening_hours, open: "29:90" }
    }).success).toBe(false);
    expect(MerchantStoreSettingsSchema.safeParse({
      ...valid,
      opening_hours: { ...valid.opening_hours, closed_days: [5, 5] }
    }).success).toBe(false);
  });
});
