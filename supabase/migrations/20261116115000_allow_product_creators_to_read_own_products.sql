-- Allow an authenticated product creator to read their own product row.
-- The atomic merchant creation RPC uses INSERT ... RETURNING before creating
-- the store offer; the market-scoped read policy cannot see that row yet.
-- This narrowly scoped policy enables RETURNING without widening catalog access.
create policy "Creators read own products"
on public.products
for select
to authenticated
using (created_by = (select auth.uid()));
