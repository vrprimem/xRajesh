-- Printing labels and closing a dispatch are the supplier's owner's (VRPRIME's people too). The warehouse person scans
-- the cartons and adds the vehicle photo, and nothing more.
--
-- The functions that close a dispatch, and that void, reprint or change the pieces of a label (which voids the old one
-- for a new one), let the warehouse person in (20261123102000 and after, applied live). Rather than copy each to change
-- one line, two guards refuse him where they all end up: a dispatch becoming closed, a label becoming void. Scanning only
-- loads cartons, so it is untouched. Downloading the labels is kept from him in the app (the label routes).

-- Refuses the supplier's warehouse login; anyone else (the supplier's owner, VRPRIME, the service role) goes on.
create function private.supplier_owner_step() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.supplier_role() = 'supplier_scanner' then
    raise exception 'only the owner can do that' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function private.supplier_owner_step() from public, anon, authenticated;

create trigger supplier_dispatches_close_by_owner
  before update of status on public.supplier_dispatches
  for each row when (new.status = 'closed' and old.status is distinct from 'closed')
  execute function private.supplier_owner_step();

create trigger supplier_cartons_void_by_owner
  before update of status on public.supplier_cartons
  for each row when (new.status = 'void' and old.status is distinct from 'void')
  execute function private.supplier_owner_step();
