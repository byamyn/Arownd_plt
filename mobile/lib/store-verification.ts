import { z } from "zod";

import { getSupabaseClient } from "@/lib/supabase";

const VerificationStatusSchema = z.enum(["draft", "pending", "approved", "rejected"]);

const StoreVerificationStoreSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  logo_url: z.string().nullable(),
  phone: z.string().nullable(),
  region_id: z.number().int().positive().nullable(),
  secondary_region_id: z.number().int().positive().nullable(),
  commune: z.string().nullable(),
  address_line: z.string().nullable(),
  opening_hours: z.object({
    open: z.string().optional(),
    close: z.string().optional(),
    closed_days: z.array(z.number()).optional()
  }).passthrough(),
  is_verified: z.boolean()
}).passthrough();

const VerificationRequestSchema = z.object({
  id: z.string().uuid(),
  status: VerificationStatusSchema,
  submitted_at: z.string(),
  reviewed_at: z.string().nullable(),
  review_note: z.string().nullable()
}).passthrough();

const VerificationQueueItemSchema = z.object({
  id: z.string().uuid(),
  store_id: z.string().uuid(),
  status: z.literal("pending"),
  submitted_at: z.string(),
  profile_snapshot: z.record(z.string(), z.unknown()),
  store: z.object({
    id: z.string().uuid(),
    name: z.string(),
    logo_url: z.string().nullable(),
    phone: z.string().nullable(),
    region_id: z.number().int().positive(),
    secondary_region_id: z.number().int().positive().nullable(),
    commune: z.string().nullable(),
    address_line: z.string().nullable(),
    opening_hours: z.object({
      open: z.string(),
      close: z.string()
    }).passthrough(),
    region: z.object({
      name_ar: z.string(),
      name_fr: z.string().nullable(),
      name_en: z.string().nullable()
    }).nullable(),
    secondary_region: z.object({
      name_ar: z.string(),
      name_fr: z.string().nullable(),
      name_en: z.string().nullable()
    }).nullable()
  }).passthrough()
}).passthrough();

export type StoreVerificationStore = z.infer<typeof StoreVerificationStoreSchema>;
export type StoreVerificationRequest = z.infer<typeof VerificationRequestSchema>;
export type StoreVerificationQueueItem = z.infer<typeof VerificationQueueItemSchema>;

export type StoreVerificationOverview = {
  store: StoreVerificationStore;
  emailConfirmed: boolean;
  latestRequest: StoreVerificationRequest | null;
};

export function getStoreVerificationRequirements(store: StoreVerificationStore, emailConfirmed: boolean) {
  return {
    storeName: store.name.trim().length >= 2,
    logo: Boolean(store.logo_url?.trim()),
    phone: Boolean(store.phone?.trim()),
    region: store.region_id !== null && Number.isInteger(store.region_id) && store.region_id > 0,
    commune: Boolean(store.commune?.trim()),
    address: Boolean(store.address_line?.trim()),
    openingHours: Boolean(store.opening_hours.open && store.opening_hours.close),
    emailConfirmed
  };
}

export async function fetchMyStoreVerificationOverview(storeId: string, signal?: AbortSignal): Promise<StoreVerificationOverview> {
  const client = getSupabaseClient();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!auth.user) throw new Error("not_authenticated");

  let storeRequest = client
    .from("stores")
    .select("id, name, logo_url, phone, region_id, secondary_region_id, commune, address_line, opening_hours, is_verified")
    .eq("id", storeId)
    .eq("owner_id", auth.user.id);
  if (signal) storeRequest = storeRequest.abortSignal(signal);
  const { data: storeData, error: storeError } = await storeRequest.maybeSingle();
  if (storeError) throw storeError;
  if (!storeData) throw new Error("merchant_store_not_found");

  let request = client
    .from("store_verification_requests")
    .select("id, status, submitted_at, reviewed_at, review_note")
    .eq("store_id", storeId)
    .order("submitted_at", { ascending: false })
    .limit(1);
  if (signal) request = request.abortSignal(signal);
  const { data: requestData, error: requestError } = await request.maybeSingle();
  if (requestError) throw requestError;

  return {
    store: StoreVerificationStoreSchema.parse(storeData as unknown),
    emailConfirmed: Boolean(auth.user.email_confirmed_at),
    latestRequest: requestData
      ? VerificationRequestSchema.parse(requestData as unknown)
      : null
  };
}

export async function submitMyStoreVerificationRequest(): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc("submit_store_verification_request");
  if (error) throw new Error(`${error.code ?? ""} ${error.message}`.trim());
  return z.string().uuid().parse(data as unknown);
}

export async function fetchStoreVerificationReviewerAccess(): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc("is_store_verification_reviewer");
  if (error) throw error;
  return z.boolean().parse(data as unknown);
}

export async function fetchStoreVerificationQueue(): Promise<StoreVerificationQueueItem[]> {
  const { data, error } = await getSupabaseClient()
    .from("store_verification_requests")
    .select("id, store_id, status, submitted_at, profile_snapshot, store:stores!inner(id, name, logo_url, phone, region_id, secondary_region_id, commune, address_line, opening_hours, region:country_regions!stores_country_region_fkey(name_ar, name_fr, name_en), secondary_region:country_regions!stores_country_secondary_region_fkey(name_ar, name_fr, name_en))")
    .eq("status", "pending")
    .order("submitted_at", { ascending: true })
    .limit(100);
  if (error) throw error;
  return VerificationQueueItemSchema.array().parse(data as unknown);
}

export async function reviewStoreVerificationRequest(
  requestId: string,
  decision: "approved" | "rejected",
  note?: string
): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc("review_store_verification_request", {
    _request_id: requestId,
    _decision: decision,
    _note: note?.trim() || null
  });
  if (error) throw new Error(`${error.code ?? ""} ${error.message}`.trim());
  return z.string().uuid().parse(data as unknown);
}
