import { z } from "zod";

import { getSupabaseClient } from "@/lib/supabase";
import { assertActionRateLimit } from "@/lib/action-rate-limit";
import { fetchMerchantOrderCompletionData } from "@/lib/order-completion";

export { getOrderStatusTone, getOrderTrackingSteps } from "@/lib/orders-state";

const OrderItemSchema = z.object({
  id: z.string(),
  product_name: z.string().nullable().optional(),
  quantity: z.coerce.number(),
  unit_price: z.coerce.number(),
  options: z.unknown().optional()
}).passthrough();

const StoreSchema = z.object({
  name: z.string().nullable().optional(),
  address_line: z.string().nullable().optional(),
  commune: z.string().nullable().optional()
}).passthrough();

const MerchantOrderSchema = z.object({
  id: z.string(),
  store_id: z.string(),
  status: z.string(),
  subtotal: z.coerce.number(),
  shipping_fee: z.coerce.number().default(0),
  quoted_at: z.string().nullable().optional(),
  payment_status: z.string().nullable().optional(),
  paid_amount: z.coerce.number().nullable().optional(),
  paid_at: z.string().nullable().optional(),
  completion_status: z.enum(["pending", "disputed", "completed"]).default("pending"),
  seller_confirmed_at: z.string().nullable().optional(),
  seller_confirmed_by: z.string().uuid().nullable().optional(),
  customer_confirmed_at: z.string().nullable().optional(),
  customer_confirmed_by: z.string().uuid().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  disputed_at: z.string().nullable().optional(),
  dispute_opened_by: z.string().uuid().nullable().optional(),
  dispute_reason: z.string().nullable().optional(),
  store: StoreSchema.nullable().optional(),
  items: z.array(OrderItemSchema).default([])
}).passthrough();

const TrackingEventSchema = z.object({
  id: z.string(),
  status: z.string(),
  note: z.string().nullable().optional(),
  created_at: z.string()
}).passthrough();

const ShipmentSchema = z.object({
  id: z.string(),
  status: z.string(),
  notes: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  merchant_order_id: z.string().nullable().optional(),
}).passthrough();

const OrderSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  status: z.string(),
  total: z.coerce.number(),
  subtotal: z.coerce.number().default(0),
  shipping_fee: z.coerce.number().default(0),
  delivery_type: z.string(),
  full_name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  address_line: z.string().nullable().optional(),
  commune: z.string().nullable().optional(),
  country_code: z.string().length(2),
  currency_code: z.string().length(3),
  region_id: z.number().nullable().optional(),
  secondary_region_id: z.number().nullable().optional(),
  region: z.object({ name_ar: z.string(), name_fr: z.string().nullable(), name_en: z.string().nullable() }).nullable().optional(),
  secondary_region: z.object({ name_ar: z.string(), name_fr: z.string().nullable(), name_en: z.string().nullable() }).nullable().optional(),
  wilaya_id: z.number().nullable().optional(),
  daira: z.object({ name_ar: z.string(), name_fr: z.string().nullable() }).nullable().optional(),
  payment_method: z.string().nullable().optional(),
  wilaya: z.object({ name_ar: z.string().nullable(), name_fr: z.string().nullable() }).nullable().optional(),
  items: z.array(OrderItemSchema).default([]),
  merchant_orders: z.array(MerchantOrderSchema).default([])
}).passthrough();

export type CustomerOrder = z.infer<typeof OrderSchema>;
export type CustomerMerchantOrder = z.infer<typeof MerchantOrderSchema>;
export type CustomerOrderItem = z.infer<typeof OrderItemSchema>;
export type CustomerShipment = z.infer<typeof ShipmentSchema>;
export type CustomerTrackingEvent = z.infer<typeof TrackingEventSchema>;

const ORDER_SELECT = [
  "*,",
  "items:order_items(*),",
  "merchant_orders(id, order_id, store_id, status, subtotal, shipping_fee, quoted_at, payment_status, paid_amount, paid_at, completion_status, seller_confirmed_at, seller_confirmed_by, customer_confirmed_at, customer_confirmed_by, completed_at, disputed_at, dispute_opened_by, dispute_reason, store:stores(name, address_line, commune), items:order_items(*)),",
  "region:country_regions!orders_country_region_fkey(name_ar, name_fr, name_en),",
  "secondary_region:country_regions!orders_country_secondary_region_fkey(name_ar, name_fr, name_en),",
  "wilaya:wilayas(name_ar, name_fr),",
  "daira:country_regions!orders_daira_region_fkey(name_ar, name_fr)"
].join(" ");

export async function fetchMyOrders(signal?: AbortSignal): Promise<CustomerOrder[]> {
  const { data: auth, error: authError } = await getSupabaseClient().auth.getUser();
  if (authError) throw authError;
  if (!auth.user) return [];
  let request = getSupabaseClient()
    .from("orders")
    .select(ORDER_SELECT)
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return OrderSchema.array().parse(data as unknown);
}

export async function fetchCustomerOrderDetails(orderId: string, signal?: AbortSignal): Promise<{
  order: CustomerOrder | null;
  shipments: CustomerShipment[];
  trackingEvents: { merchantOrderId: string; events: CustomerTrackingEvent[] }[];
  completionData: Awaited<ReturnType<typeof fetchMerchantOrderCompletionData>>;
}> {
  const { data: auth, error: authError } = await getSupabaseClient().auth.getUser();
  if (authError) throw authError;
  if (!auth.user) throw new Error("not_authenticated");
  const client = getSupabaseClient();
  let orderRequest = client.from("orders").select(ORDER_SELECT).eq("id", orderId).eq("user_id", auth.user.id);
  let shipmentsRequest = client.from("shipments").select("id, status, notes, updated_at, created_at, merchant_order_id").eq("order_id", orderId).order("created_at", { ascending: true });
  if (signal) {
    orderRequest = orderRequest.abortSignal(signal);
    shipmentsRequest = shipmentsRequest.abortSignal(signal);
  }
  const [{ data: order, error: orderError }, { data: shipments, error: shipmentError }] = await Promise.all([
    orderRequest.maybeSingle(),
    shipmentsRequest
  ]);
  if (orderError) throw orderError;
  if (shipmentError) throw shipmentError;
  const parsedOrder = order ? OrderSchema.parse(order as unknown) : null;
  const merchantOrderIds = parsedOrder?.merchant_orders.map((merchantOrder) => merchantOrder.id) ?? [];
  const trackingEvents: { merchantOrderId: string; events: CustomerTrackingEvent[] }[] =
    merchantOrderIds.map((merchantOrderId) => ({ merchantOrderId, events: [] }));

  if (merchantOrderIds.length > 0) {
    type TrackingRpcResult = { data: unknown; error: { message?: string } | null };
    type TrackingRpcRequest = Promise<TrackingRpcResult> & {
      abortSignal: (abortSignal: AbortSignal) => TrackingRpcRequest;
    };
    const call = client.rpc.bind(client) as unknown as (
      functionName: string,
      args: { _merchant_order_ids: string[] }
    ) => TrackingRpcRequest;
    let request = call("fetch_customer_order_tracking", {
      _merchant_order_ids: merchantOrderIds
    });
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;
    if (error) throw new Error(error.message ?? "order_tracking_load_failed");

    const BatchTrackingEventSchema = TrackingEventSchema.extend({
      merchant_order_id: z.string()
    });
    const events = BatchTrackingEventSchema.array().parse(data as unknown);
    const eventsByOrder = new Map(merchantOrderIds.map((merchantOrderId) => [merchantOrderId, [] as CustomerTrackingEvent[]]));
    for (const event of events) {
      const orderEvents = eventsByOrder.get(event.merchant_order_id);
      if (orderEvents) {
        const { merchant_order_id: _merchantOrderId, ...trackingEvent } = event;
        orderEvents.push(trackingEvent);
      }
    }
    for (const entry of trackingEvents) {
      entry.events = eventsByOrder.get(entry.merchantOrderId) ?? [];
    }
  }
  const completionData = await fetchMerchantOrderCompletionData(merchantOrderIds, signal);
  return {
    order: parsedOrder,
    shipments: ShipmentSchema.array().parse(shipments as unknown),
    trackingEvents,
    completionData
  };
}

/** Customer accepts or declines a merchant's shipping quote through the guarded RPC. */
export async function respondToMerchantQuote(merchantOrderId: string, accept: boolean): Promise<void> {
  assertActionRateLimit("order:quote-response:" + merchantOrderId, 2_000);
  const client = getSupabaseClient();
  const call = client.rpc.bind(client) as unknown as (
    functionName: string,
    args: { _merchant_order_id: string; _accept: boolean }
  ) => Promise<{ error: { message?: string } | null }>;
  const { error } = await call("customer_respond_to_merchant_order", {
    _merchant_order_id: merchantOrderId,
    _accept: accept
  });
  if (error) throw new Error(error.message ?? "quote_response_failed");
}

/** Cancel a pending store suborder; authorization and stock restoration are server-side. */
export async function cancelMyMerchantOrder(merchantOrderId: string): Promise<void> {
  assertActionRateLimit("order:cancel-merchant:" + merchantOrderId, 2_000);
  const { error } = await getSupabaseClient().rpc("cancel_my_merchant_order", {
    _merchant_order_id: merchantOrderId
  });
  if (error) throw new Error(error.message ?? "merchant_order_cancel_failed");
}

/** Cancel a legacy single-store order while it is still pending. */
export async function cancelMyOrder(orderId: string): Promise<void> {
  assertActionRateLimit("order:cancel:" + orderId, 2_000);
  const { error } = await getSupabaseClient().rpc("cancel_my_order", {
    _order_id: orderId
  });
  if (error) throw new Error(error.message ?? "order_cancel_failed");
}
