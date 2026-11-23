-- Allow Arownd Team support staff to read attachments belonging to conversations they can access.
begin;
drop policy if exists "Customers read own support attachments" on storage.objects;
create policy "Customers and Arownd team read support attachments"
on storage.objects for select to authenticated
using (
  bucket_id='support-attachments'
  and exists (
    select 1 from public.support_conversations c
    where c.id::text=(storage.foldername(objects.name))[1]
      and (c.user_id=(select auth.uid()) or private.has_team_permission('support.view'))
  )
);
commit;