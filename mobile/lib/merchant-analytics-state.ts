import { z } from "zod";

export const MerchantAnalyticsSchema = z.object({
  orders_total: z.coerce.number().int().nonnegative(),
  delivered_orders: z.coerce.number().int().nonnegative(),
  active_orders: z.coerce.number().int().nonnegative(),
  cancelled_orders: z.coerce.number().int().nonnegative(),
  delivered_revenue: z.coerce.number().nonnegative(),
  average_delivered_order: z.coerce.number().nonnegative(),
  product_count: z.coerce.number().int().nonnegative(),
  low_stock_count: z.coerce.number().int().nonnegative(),
  out_of_stock_count: z.coerce.number().int().nonnegative(),
  daily_delivered: z.array(z.object({
    day: z.string(),
    amount: z.coerce.number().nonnegative()
  })).max(7)
});

export const MerchantBusinessAnalyticsSchema = z.object({
  period: z.enum(["7d", "30d", "90d", "custom"]),
  from_date: z.string(),
  to_date: z.string(),
  previous_from_date: z.string(),
  previous_to_date: z.string(),
  revenue: z.coerce.number().nonnegative(),
  previous_revenue: z.coerce.number().nonnegative(),
  revenue_change_percent: z.coerce.number().nullable(),
  orders_total: z.coerce.number().int().nonnegative(),
  delivered_orders: z.coerce.number().int().nonnegative(),
  active_orders: z.coerce.number().int().nonnegative(),
  cancelled_orders: z.coerce.number().int().nonnegative(),
  rejected_orders: z.coerce.number().int().nonnegative(),
  average_order: z.coerce.number().nonnegative(),
  delivery_rate_percent: z.coerce.number().min(0).max(100),
  cancellation_rate_percent: z.coerce.number().min(0).max(100),
  estimated_delivery_dates: z.coerce.number().int().nonnegative(),
  daily_sales: z.array(z.object({
    day: z.string(),
    amount: z.coerce.number().nonnegative()
  })).max(365),
  top_products: z.array(z.object({
    name: z.string(),
    units_sold: z.coerce.number().int().nonnegative(),
    revenue: z.coerce.number().nonnegative()
  })).max(5),
  slow_products: z.array(z.object({
    name: z.string(),
    stock_quantity: z.coerce.number().int().nonnegative()
  })).max(5),
  product_count: z.coerce.number().int().nonnegative(),
  low_stock_count: z.coerce.number().int().nonnegative(),
  out_of_stock_count: z.coerce.number().int().nonnegative()
});

export type MerchantAnalytics = z.infer<typeof MerchantAnalyticsSchema>;
export type MerchantBusinessAnalytics = z.infer<typeof MerchantBusinessAnalyticsSchema>;
export type MerchantAnalyticsPeriod = MerchantBusinessAnalytics["period"];
