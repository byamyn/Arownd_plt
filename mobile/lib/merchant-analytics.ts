import { getSupabaseClient } from "@/lib/supabase";
import {
  MerchantAnalyticsSchema,
  MerchantBusinessAnalyticsSchema,
  type MerchantAnalytics,
  type MerchantAnalyticsPeriod,
  type MerchantBusinessAnalytics
} from "@/lib/merchant-analytics-state";

export async function fetchMerchantAnalytics(storeId: string, signal?: AbortSignal): Promise<MerchantAnalytics> {
  const client = getSupabaseClient();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!auth.user) throw new Error("not_authenticated");

  let request = client.rpc("get_my_store_analytics", {
    _store_id: storeId
  });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return MerchantAnalyticsSchema.parse(data as unknown);
}

export async function fetchMerchantBusinessAnalytics(
  storeId: string,
  period: MerchantAnalyticsPeriod,
  fromDate?: string,
  toDate?: string,
  signal?: AbortSignal
): Promise<MerchantBusinessAnalytics> {
  const client = getSupabaseClient();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!auth.user) throw new Error("not_authenticated");

  let request = client.rpc("get_my_store_business_analytics", {
    _store_id: storeId,
    _period: period,
    _from_date: period === "custom" ? fromDate ?? null : null,
    _to_date: period === "custom" ? toDate ?? null : null
  });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return MerchantBusinessAnalyticsSchema.parse(data as unknown);
}
