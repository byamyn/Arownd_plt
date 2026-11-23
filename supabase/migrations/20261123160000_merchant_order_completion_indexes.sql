-- Index foreign-key columns added by the dual-confirmation workflow.
create index if not exists merchant_order_completion_events_order_id_idx
  on public.merchant_order_completion_events(order_id);
create index if not exists merchant_order_completion_events_actor_id_idx
  on public.merchant_order_completion_events(actor_id);
create index if not exists merchant_orders_seller_confirmed_by_idx
  on public.merchant_orders(seller_confirmed_by)
  where seller_confirmed_by is not null;
create index if not exists merchant_orders_customer_confirmed_by_idx
  on public.merchant_orders(customer_confirmed_by)
  where customer_confirmed_by is not null;
create index if not exists merchant_orders_dispute_opened_by_idx
  on public.merchant_orders(dispute_opened_by)
  where dispute_opened_by is not null;
