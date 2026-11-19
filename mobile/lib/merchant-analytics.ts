import { getSupabaseClient } from "@/lib/supabase";
import { MerchantAnalyticsSchema, type MerchantAnalytics } from "@/lib/merchant-analytics-state";

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
