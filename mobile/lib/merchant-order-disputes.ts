import { z } from "zod";
import type { ImagePickerAsset } from "expo-image-picker";

import { assertActionRateLimit } from "@/lib/action-rate-limit";
import { getSupabaseClient } from "@/lib/supabase";

const DisputeSchema = z.object({
  id: z.string().uuid(),
  merchant_order_id: z.string().uuid(),
  order_id: z.string().uuid(),
  store_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  opened_by: z.string().uuid(),
  reason: z.string(),
  status: z.enum(["open", "in_review", "resolved"]),
  resolution_note: z.string().nullable(),
  resolved_by: z.string().uuid().nullable(),
  resolved_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const DisputeMessageSchema = z.object({
  id: z.string().uuid(),
  dispute_id: z.string().uuid(),
  merchant_order_id: z.string().uuid(),
  order_id: z.string().uuid(),
  sender_id: z.string().uuid(),
  sender_role: z.enum(["customer", "merchant", "support"]),
  message: z.string(),
  attachment_path: z.string().nullable(),
  created_at: z.string()
});

const DisputeTimelineEventSchema = z.object({
  id: z.string().uuid(),
  merchant_order_id: z.string().uuid(),
  action: z.enum([
    "seller_confirmed_delivery_and_cash",
    "customer_confirmed_receipt_and_payment",
    "customer_opened_dispute",
    "support_resolved_dispute"
  ]),
  actor_id: z.string().uuid(),
  actor_type: z.enum(["seller", "customer", "support"]),
  reason: z.string().nullable(),
  created_at: z.string()
});

export const disputeMessageInputSchema = z.object({
  message: z.string().trim().max(4000)
});

export type MerchantOrderDispute = z.infer<typeof DisputeSchema>;
export type MerchantOrderDisputeMessage = z.infer<typeof DisputeMessageSchema> & {
  attachment_url: string | null;
};
export type DisputeParticipantRole = "customer" | "merchant";

export async function fetchMerchantOrderDispute(
  merchantOrderId: string,
  signal?: AbortSignal
): Promise<MerchantOrderDispute | null> {
  let request = getSupabaseClient()
    .from("merchant_order_disputes")
    .select("id, merchant_order_id, order_id, store_id, customer_id, opened_by, reason, status, resolution_note, resolved_by, resolved_at, created_at, updated_at")
    .eq("merchant_order_id", merchantOrderId);
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request.maybeSingle();
  if (error) throw error;
  return data ? DisputeSchema.parse(data as unknown) : null;
}

export async function fetchMerchantOrderDisputeById(
  disputeId: string,
  signal?: AbortSignal
): Promise<MerchantOrderDispute | null> {
  let request = getSupabaseClient()
    .from("merchant_order_disputes")
    .select("id, merchant_order_id, order_id, store_id, customer_id, opened_by, reason, status, resolution_note, resolved_by, resolved_at, created_at, updated_at")
    .eq("id", disputeId);
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request.maybeSingle();
  if (error) throw error;
  return data ? DisputeSchema.parse(data as unknown) : null;
}

export async function getMerchantOrderDisputeParticipantRole(
  disputeId: string
): Promise<DisputeParticipantRole | null> {
  const { data, error } = await getSupabaseClient()
    .rpc("current_user_merchant_order_dispute_role", { _dispute_id: disputeId });
  if (error) throw error;
  return data === "customer" || data === "merchant" ? data : null;
}

export type MerchantOrderDisputeTimelineEvent = z.infer<typeof DisputeTimelineEventSchema>;

export async function fetchMerchantOrderDisputeTimeline(
  merchantOrderId: string,
  signal?: AbortSignal
): Promise<MerchantOrderDisputeTimelineEvent[]> {
  let request = getSupabaseClient()
    .from("merchant_order_completion_events")
    .select("id, merchant_order_id, action, actor_id, actor_type, reason, created_at")
    .eq("merchant_order_id", merchantOrderId)
    .order("created_at", { ascending: true });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return DisputeTimelineEventSchema.array().parse(data as unknown);
}

export async function fetchMerchantOrderDisputeMessages(
  disputeId: string,
  signal?: AbortSignal
): Promise<MerchantOrderDisputeMessage[]> {
  let request = getSupabaseClient()
    .from("merchant_order_dispute_messages")
    .select("id, dispute_id, merchant_order_id, order_id, sender_id, sender_role, message, attachment_path, created_at")
    .eq("dispute_id", disputeId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  const messages = DisputeMessageSchema.array().parse(data as unknown);
  return Promise.all(messages.map(async (item) => {
    if (!item.attachment_path) return { ...item, attachment_url: null };
    const { data: signed, error: signedError } = await getSupabaseClient()
      .storage.from("merchant-order-disputes")
      .createSignedUrl(item.attachment_path, 3600);
    if (signedError) return { ...item, attachment_url: null };
    return { ...item, attachment_url: signed.signedUrl };
  }));
}

export async function sendMerchantOrderDisputeMessage(
  disputeId: string,
  message: string,
  attachment?: ImagePickerAsset | null
): Promise<void> {
  const safeMessage = message.trim();
  if (!safeMessage && !attachment) throw new Error("dispute_message_required");
  if (safeMessage.length > 4000) throw new Error("dispute_message_too_long");

  assertActionRateLimit("merchant-order-dispute:message:" + disputeId, 1_200);
  const client = getSupabaseClient();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!auth.user) throw new Error("not_authenticated");

  const { data: role, error: roleError } = await client
    .rpc("current_user_merchant_order_dispute_role", { _dispute_id: disputeId });
  if (roleError) throw roleError;
  if (role !== "customer" && role !== "merchant") {
    throw new Error("not_authorized");
  }

  let attachmentPath: string | null = null;
  if (attachment) {
    if (typeof attachment.fileSize === "number" && attachment.fileSize > 10 * 1024 * 1024) {
      throw new Error("dispute_attachment_too_large");
    }
    const mimeType = attachment.mimeType === "image/png"
      ? "image/png"
      : attachment.mimeType === "image/webp"
        ? "image/webp"
        : attachment.mimeType === "image/jpeg" || attachment.mimeType === "image/jpg" || !attachment.mimeType
          ? "image/jpeg"
          : null;
    if (!mimeType) throw new Error("dispute_attachment_unsupported_type");
    const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
    const blob = await fetch(attachment.uri).then(async (response) => {
      if (!response.ok) throw new Error("dispute_attachment_read_failed");
      return response.blob();
    });
    const fileName = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10) + "." + extension;
    attachmentPath = disputeId + "/" + auth.user.id + "/" + fileName;
    const { error: uploadError } = await client.storage
      .from("merchant-order-disputes")
      .upload(attachmentPath, blob, {
        contentType: mimeType,
        cacheControl: "3600",
        upsert: false
      });
    if (uploadError) throw uploadError;
  }

  const { error } = await client.from("merchant_order_dispute_messages").insert({
    dispute_id: disputeId,
    sender_id: auth.user.id,
    sender_role: role,
    message: safeMessage,
    attachment_path: attachmentPath
  });
  if (error) throw error;
}
