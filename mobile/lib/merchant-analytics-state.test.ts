import { describe, expect, it } from "vitest";
import { MerchantAnalyticsSchema, MerchantBusinessAnalyticsSchema } from "@/lib/merchant-analytics-state";

describe("MerchantAnalyticsSchema", () => {
  it("accepts server aggregates", () => {
    expect(MerchantAnalyticsSchema.safeParse({
      orders_total: 12,
      delivered_orders: 7,
      active_orders: 3,
      cancelled_orders: 2,
      delivered_revenue: 18000,
      average_delivered_order: 2571,
      product_count: 9,
      low_stock_count: 2,
      out_of_stock_count: 1,
      daily_delivered: [{ day: "2026-11-08", amount: 3000 }]
    }).success).toBe(true);
  });

  it("rejects a daily series longer than seven days", () => {
    const daily = Array.from({ length: 8 }, (_, index) => ({
      day: `2026-11-${String(index + 1).padStart(2, "0")}`,
      amount: 100
    }));
    expect(MerchantAnalyticsSchema.safeParse({
      orders_total: 8,
      delivered_orders: 8,
      active_orders: 0,
      cancelled_orders: 0,
      delivered_revenue: 800,
      average_delivered_order: 100,
      product_count: 1,
      low_stock_count: 0,
      out_of_stock_count: 0,
      daily_delivered: daily
    }).success).toBe(false);
  });

  it("rejects negative aggregates", () => {
    expect(MerchantAnalyticsSchema.safeParse({
      orders_total: -1,
      delivered_orders: 0,
      active_orders: 0,
      cancelled_orders: 0,
      delivered_revenue: 0,
      average_delivered_order: 0,
      product_count: 0,
      low_stock_count: 0,
      out_of_stock_count: 0,
      daily_delivered: []
    }).success).toBe(false);
  });
});


describe("MerchantBusinessAnalyticsSchema", () => {
  const validPayload = {
    period: "30d",
    from_date: "2026-10-29",
    to_date: "2026-11-27",
    previous_from_date: "2026-09-29",
    previous_to_date: "2026-10-28",
    revenue: 53000,
    previous_revenue: 0,
    revenue_change_percent: null,
    orders_total: 8,
    delivered_orders: 4,
    active_orders: 0,
    cancelled_orders: 4,
    rejected_orders: 0,
    average_order: 13250,
    delivery_rate_percent: 50,
    cancellation_rate_percent: 50,
    estimated_delivery_dates: 2,
    daily_sales: [{ day: "2026-11-04", amount: 2000 }],
    top_products: [{ name: "Product A", units_sold: 2, revenue: 2000 }],
    slow_products: [{ name: "Product B", stock_quantity: 3 }],
    product_count: 2,
    low_stock_count: 1,
    out_of_stock_count: 0
  };

  it("accepts business analytics aggregates and optional growth", () => {
    expect(MerchantBusinessAnalyticsSchema.safeParse(validPayload).success).toBe(true);
  });

  it("rejects invalid completion rates", () => {
    expect(MerchantBusinessAnalyticsSchema.safeParse({
      ...validPayload,
      delivery_rate_percent: 120
    }).success).toBe(false);
  });

  it("rejects unsupported periods", () => {
    expect(MerchantBusinessAnalyticsSchema.safeParse({
      ...validPayload,
      period: "365d"
    }).success).toBe(false);
  });
});
