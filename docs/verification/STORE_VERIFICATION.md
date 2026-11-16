# Arownd Store Verification

## Scope

This workflow verifies merchant stores only. Customer accounts are not part of it.

A store can submit a verification request only when:
- The owning account's email is confirmed in Supabase Auth.
- Store name, logo, phone, primary administrative region, municipality, address, and opening hours are present.
- The phone number is stored as store contact information. Phone OTP verification is intentionally out of scope.

Description, WhatsApp, category, map coordinates, and phone OTP are not verification requirements.

## Request lifecycle

- `pending`: submitted and awaiting an authorized reviewer.
- `approved`: reviewed and approved; the store's `is_verified` flag is true.
- `rejected`: reviewed and rejected with a required reviewer note.
- `draft`: a previously pending request whose required store profile changed before review. The merchant must submit a new request.
- If a verified store changes any required identity field, its badge is revoked automatically and the updated profile must pass a fresh review.

Every submission and review decision is written to `store_verification_audit_events`.

## Reviewer access

Review access is an explicit assignment, not an application-wide admin role. The migration does not restore the removed legacy admin role or grant platform-wide access to orders, profiles, or other data.

After the migration has been reviewed and approved for the target Supabase environment, assign a reviewer through the Supabase SQL Editor:

```sql
insert into public.store_verification_reviewers (user_id)
values ('<AUTH_USER_UUID>')
on conflict (user_id) do update
set is_active = true;
```

Revoke review access without deleting the audit trail:

```sql
update public.store_verification_reviewers
set is_active = false
where user_id = '<AUTH_USER_UUID>';
```

Only trusted platform staff should receive this assignment. Authenticated clients cannot insert, update, or delete reviewer assignments.

Assigned reviewers see the moderation entry in the account screen. The route is also protected by a server-side reviewer check and database RLS/RPC authorization.

## Migration and rollout

Migration source:
`supabase/migrations/20261116042240_store_verification_workflow.sql`

Security follow-up:
`supabase/migrations/20261116042302_revoke_store_verification_trigger_function_execute.sql`

The migration:
- Changes the default for new stores to `is_verified = false`.
- Forces newly inserted stores to remain unverified.
- Sets every existing store to unverified so all current stores must be re-reviewed.
- Creates request, reviewer-assignment, and audit tables with RLS.
- Adds server-side submission and review RPCs.
- Invalidates a pending request when required store profile fields change.

**Applied to the production Supabase project on 2026-11-16.** The migration reset all existing store verification flags to `false`; the three existing stores must complete a fresh review. The follow-up migration revokes direct `EXECUTE` access to the SECURITY DEFINER profile-change trigger function. The legacy migration history still contains repository/database drift; do not bulk-push or replay historical migrations without a separate reconciliation.

The migration does not delete stores, products, offers, orders, or customer data.
