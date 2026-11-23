import { z } from "zod";

import { assertActionRateLimit } from "@/lib/action-rate-limit";
import { getSupabaseClient } from "@/lib/supabase";

const CompletionEventSchema = z.object({
  id: z.string().uuid(),
  merchant_order_id: z.string().uuid(),
  action: z.enum([
    "seller_confirmed_delivery_and_cash",
    "customer_confirmed_receipt_and_payment",
    "customer_opened_dispute"
  ]),
  actor_id: z.string().uuid(),
  actor_type: z.enum(["seller", "customer"]),
  reason: z.string().nullable(),
  created_at: z.string()
}).passthrough();

const DisputeTicketSchema = z.object({
  id: z.string().uuid(),
  merchant_order_id: z.string().uuid(),
  reason: z.string(),
  status: z.enum(["open", "in_review", "resolved"]),
  resolution_note: z.string().nullable(),
  resolved_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
}).passthrough();

export type MerchantOrderCompletionEvent = z.infer<typeof CompletionEventSchema>;
export type MerchantOrderDisputeTicket = z.infer<typeof DisputeTicketSchema>;

export type MerchantOrderCompletionData = {
  eventsByMerchantOrderId: Record<string, MerchantOrderCompletionEvent[]>;
  disputesByMerchantOrderId: Record<string, MerchantOrderDisputeTicket>;
};

export async function fetchMerchantOrderCompletionData(
  merchantOrderIds: string[],
  signal?: AbortSignal
): Promise<MerchantOrderCompletionData> {
  const uniqueIds = [...new Set(merchantOrderIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return { eventsByMerchantOrderId: {}, disputesByMerchantOrderId: {} };
  }

  const client = getSupabaseClient();
  let eventsRequest = client
    .from("merchant_order_completion_events")
    .select("id, merchant_order_id, action, actor_id, actor_type, reason, created_at")
    .in("merchant_order_id", uniqueIds)
    .order("created_at", { ascending: true });
  let disputesRequest = client
    .from("merchant_order_disputes")
    .select("id, merchant_order_id, reason, status, resolution_note, resolved_at, created_at, updated_at")
    .in("merchant_order_id", uniqueIds);

  if (signal) {
    eventsRequest = eventsRequest.abortSignal(signal);
    disputesRequest = disputesRequest.abortSignal(signal);
  }

  const [eventsResult, disputesResult] = await Promise.all([eventsRequest, disputesRequest]);
  if (eventsResult.error) throw eventsResult.error;
  if (disputesResult.error) throw disputesResult.error;

  return parseMerchantOrderCompletionData(eventsResult.data, disputesResult.data);
}

export function parseMerchantOrderCompletionData(
  eventsInput: unknown,
  disputesInput: unknown
): MerchantOrderCompletionData {
  const events = CompletionEventSchema.array().parse(eventsInput);
  const disputes = DisputeTicketSchema.array().parse(disputesInput);
  const eventsByMerchantOrderId: Record<string, MerchantOrderCompletionEvent[]> = {};
  const disputesByMerchantOrderId: Record<string, MerchantOrderDisputeTicket> = {};

  for (const event of events) {
    (eventsByMerchantOrderId[event.merchant_order_id] ??= []).push(event);
  }
  for (const dispute of disputes) {
    disputesByMerchantOrderId[dispute.merchant_order_id] = dispute;
  }

  return { eventsByMerchantOrderId, disputesByMerchantOrderId };
}

export async function confirmMerchantOrderReceiptAndPayment(merchantOrderId: string): Promise<void> {
  assertActionRateLimit("order:completion-confirm:" + merchantOrderId, 2_000);
  const { error } = await getSupabaseClient().rpc("customer_confirm_merchant_order_completion", {
    _merchant_order_id: merchantOrderId
  });
  if (error) throw new Error(error.message ?? "merchant_order_completion_failed");
}

export async function openMerchantOrderDispute(merchantOrderId: string, reason: string): Promise<void> {
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 1 || normalizedReason.length > 1000) {
    throw new Error("invalid_dispute_reason");
  }
  assertActionRateLimit("order:dispute:" + merchantOrderId, 2_000);
  const { error } = await getSupabaseClient().rpc("customer_open_merchant_order_dispute", {
    _merchant_order_id: merchantOrderId,
    _reason: normalizedReason
  });
  if (error) throw new Error(error.message ?? "merchant_order_dispute_failed");
}
