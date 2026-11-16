import { z } from "zod";

function isStoreMediaUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "nagzoafkitfsqlcwsdau.supabase.co" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== ""
    ) return false;

    if (url.pathname.startsWith("/storage/v1/object/public/store-media/")) {
      return url.search === "";
    }

    if (url.pathname.startsWith("/storage/v1/object/sign/store-media/")) {
      return url.searchParams.has("token") &&
        url.searchParams.get("token")!.length > 0 &&
        [...url.searchParams.keys()].length === 1;
    }

    return false;
  } catch {
    return false;
  }
}

function isHttpsUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export const MerchantStoreSettingsSchema = z.object({
  name: z.string().trim().min(2).max(100),
  region_id: z.number().int().positive(),
  secondary_region_id: z.number().int().positive().nullable(),
  logo_url: z.string().trim().max(1000).refine(isStoreMediaUrl),
  cover_url: z.string().trim().max(1000).refine(isStoreMediaUrl),
  description: z.string().trim().max(2000),
  phone: z.string().trim().regex(/^[+0-9()\s-]{7,20}$/),
  whatsapp: z.string().trim().max(20).refine((value) => value.length === 0 || /^[+0-9()\s-]{7,20}$/.test(value)),
  commune: z.string().trim().min(2).max(80),
  address_line: z.string().trim().min(4).max(300),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
  opening_hours: z.object({
    open: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    close: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    closed_days: z.array(z.number().int().min(0).max(6)).max(7).refine((days) => new Set(days).size === days.length)
  }),
  instagram_url: z.string().trim().max(300).refine(isHttpsUrl),
  facebook_url: z.string().trim().max(300).refine(isHttpsUrl),
  tiktok_url: z.string().trim().max(300).refine(isHttpsUrl),
  website_url: z.string().trim().max(300).refine(isHttpsUrl)
}).superRefine((values, context) => {
  if ((values.latitude === null) !== (values.longitude === null)) {
    context.addIssue({
      code: "custom",
      path: ["latitude"],
      message: "store_location_coordinates_must_be_paired"
    });
  }
});

export type MerchantStoreSettings = z.infer<typeof MerchantStoreSettingsSchema>;

export function parseMerchantStoreSettings(value: unknown): MerchantStoreSettings {
  return MerchantStoreSettingsSchema.parse(value);
}
