-- Deleting a dispatch for good: VRPRIME's owner and admin only (the user, 2026-11-26; until then dispatches were never
-- deleted). The supplier's logins cannot.
--
--   supplier_dispatch_delete        its lines, labels, label requests and scans go with it (their foreign keys
--                                   cascade); a send plan made into it stays, no longer linked; notifications that lead to
--                                   it go too. If it was still to be loaded, the supplier's logins are told to stop.
--                                   Labels already printed stay in the VRPRIME inventory software as they are: the portal
--                                   never changes it. Returns the dispatch's supplier, for the app to remove its vehicle
--                                   photos ("<supplier>/<dispatch>/...").
--   private.supplier_dispatch_gone  the numbers of deleted dispatches. Printed labels and challans carry a dispatch's
--                                   number, so a new dispatch never gets one of them again: it is numbered past them.

create table private.supplier_dispatch_gone (
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  number integer not null,
  deleted_at timestamptz not null default now(),
  deleted_by uuid references public.profiles (id) on delete set null,
  primary key (supplier_id, number)
);
alter table private.supplier_dispatch_gone enable row level security;
revoke all on private.supplier_dispatch_gone from public, anon, authenticated;

-- A new dispatch is numbered past every deleted one of its supplier (supplier_dispatch_create numbers it after the
-- dispatches that are left).
create function private.supplier_dispatch_number_past_gone() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select greatest(new.number, coalesce(max(g.number), 0) + 1) into new.number
  from private.supplier_dispatch_gone g where g.supplier_id = new.supplier_id;
  return new;
end $$;
revoke all on function private.supplier_dispatch_number_past_gone() from public, anon, authenticated;

create trigger supplier_dispatches_number_past_gone
  before insert on public.supplier_dispatches
  for each row execute function private.supplier_dispatch_number_past_gone();

create function public.supplier_dispatch_delete(p_dispatch uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  d public.supplier_dispatches%rowtype;
  u uuid;
begin
  perform private.require_staff();
  select * into d from public.supplier_dispatches where id = p_dispatch for update;
  if not found then
    raise exception 'this dispatch is no longer there' using errcode = '22023';
  end if;
  insert into private.supplier_dispatch_gone (supplier_id, number, deleted_by) values (d.supplier_id, d.number, (select auth.uid()))
  on conflict (supplier_id, number) do nothing;
  -- Notifications that would open a page no longer there.
  delete from public.notifications where url like '%/dispatches/' || d.id::text || '%';
  delete from public.supplier_dispatches where id = d.id;
  -- One still to be loaded: the supplier's people are told to stop, as when VRPRIME deletes a send plan.
  if d.status in ('planned', 'loading') then
    for u in select p.id from public.profiles p
             where p.active and p.role in ('supplier_owner', 'supplier_scanner') and p.supplier_id = d.supplier_id loop
      insert into public.notifications (user_id, kind, url, title, body)
      values (u, 'supplier_dispatch', '/supplier/dispatches', 'VRPRIME deleted dispatch ' || d.number, 'Do not load it any more.');
    end loop;
  end if;
  return d.supplier_id;
end $$;

revoke all on function public.supplier_dispatch_delete(uuid) from public, anon;
grant execute on function public.supplier_dispatch_delete(uuid) to authenticated, service_role;
