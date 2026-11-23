import { describe, expect, it } from "vitest";

import { parseMerchantOrderCompletionData } from "@/lib/order-completion";

const merchantOrderId = "00000000-0000-4000-8000-000000000001";
const customerId = "00000000-0000-4000-8000-000000000002";
const sellerId = "00000000-0000-4000-8000-000000000003";

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    merchant_order_id: merchantOrderId,
    action: "seller_confirmed_delivery_and_cash",
    actor_id: sellerId,
    actor_type: "seller",
    reason: null,
    created_at: "2026-11-23T10:00:00.000Z",
    ...overrides
  };
}

function makeTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000020",
    merchant_order_id: merchantOrderId,
    reason: "لم يصل المنتج بالحالة المتفق عليها",
    status: "open",
    resolution_note: null,
    resolved_at: null,
    created_at: "2026-11-23T11:00:00.000Z",
    updated_at: "2026-11-23T11:00:00.000Z",
    ...overrides
  };
}

describe("merchant order completion response parsing", () => {
  it("groups completion events and the dispute ticket by merchant order", () => {
    const secondEvent = makeEvent({
      id: "00000000-0000-4000-8000-000000000011",
      action: "customer_opened_dispute",
      actor_id: customerId,
      actor_type: "customer",
      reason: "لم يصل المنتج بالحالة المتفق عليها"
    });

    const result = parseMerchantOrderCompletionData(
      [makeEvent(), secondEvent],
      [makeTicket()]
    );

    expect(result.eventsByMerchantOrderId[merchantOrderId]).toHaveLength(2);
    expect(result.eventsByMerchantOrderId[merchantOrderId]?.[1]?.actor_type).toBe("customer");
    expect(result.disputesByMerchantOrderId[merchantOrderId]?.status).toBe("open");
  });

  it("accepts the support resolution event in the append-only timeline", () => {
    const supportEvent = makeEvent({
      id: "00000000-0000-4000-8000-000000000012",
      action: "support_resolved_dispute",
      actor_id: "00000000-0000-4000-8000-000000000004",
      actor_type: "support",
      reason: "تم الاتفاق على الحل بين الطرفين"
    });
    const result = parseMerchantOrderCompletionData([supportEvent], []);
    expect(result.eventsByMerchantOrderId[merchantOrderId]?.[0]?.actor_type).toBe("support");
    expect(result.eventsByMerchantOrderId[merchantOrderId]?.[0]?.action).toBe("support_resolved_dispute");
  });

  it("returns empty maps when there are no completion records", () => {
    expect(parseMerchantOrderCompletionData([], [])).toEqual({
      eventsByMerchantOrderId: {},
      disputesByMerchantOrderId: {}
    });
  });

  it("rejects unknown completion actions instead of silently accepting them", () => {
    expect(() => parseMerchantOrderCompletionData(
      [makeEvent({ action: "seller_closed_order" })],
      []
    )).toThrow();
  });

  it("rejects unknown dispute ticket states", () => {
    expect(() => parseMerchantOrderCompletionData(
      [],
      [makeTicket({ status: "auto_closed" })]
    )).toThrow();
  });

  it("rejects records without valid actor identities", () => {
    expect(() => parseMerchantOrderCompletionData(
      [makeEvent({ actor_id: "not-a-uuid" })],
      []
    )).toThrow();
  });
});
