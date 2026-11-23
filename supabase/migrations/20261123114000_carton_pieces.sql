-- Changing the pieces in a carton. The inventory software prints each label with its pieces per carton (qtyPerCarton)
-- and adds that many pieces to stock when the carton is scanned in at VRPRIME. So a carton that holds a different count
-- (a smaller box, a short last carton) needs a new label with the right count: the old label is voided ('pieces
-- changed') and a new one is asked for with the new count, the way a reprint is. The new label goes on that carton in
-- place of the old one.
--
--   supplier_label_requests  a new label asked for with its own pieces count, until the inventory software makes it
--
-- Only a label not loaded yet can be changed, while the dispatch is being loaded; the supplier's logins (the warehouse
-- person too) and VRPRIME may do it. A label with a count other than its line's goes out with no carton weight: the
-- line's weight is for a full carton.

create table public.supplier_label_requests (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references public.supplier_dispatches (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  product_id uuid not null references public.supplier_products (id) on delete cascade,
  carton_type text not null check (carton_type in ('H', 'T')),
  units integer not null check (units between 1 and 100000),
  -- The label it replaces, and the label it became once made.
  replaces uuid references public.supplier_cartons (id) on delete set null,
  done_carton uuid references public.supplier_cartons (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index supplier_label_requests_open_idx on public.supplier_label_requests (dispatch_id) where done_carton is null;
create index supplier_label_requests_dispatch_idx on public.supplier_label_requests (dispatch_id);
create index supplier_label_requests_supplier_idx on public.supplier_label_requests (supplier_id);
create index supplier_label_requests_product_idx on public.supplier_label_requests (product_id);
create index supplier_label_requests_replaces_idx on public.supplier_label_requests (replaces);
create index supplier_label_requests_done_idx on public.supplier_label_requests (done_carton);
create index supplier_label_requests_created_by_idx on public.supplier_label_requests (created_by);

alter table public.supplier_label_requests enable row level security;
revoke all on public.supplier_label_requests from public, anon, authenticated;
grant select on public.supplier_label_requests to authenticated;
grant all on public.supplier_label_requests to service_role;
create policy supplier_label_requests_select on public.supplier_label_requests for select to authenticated
  using ((select private.can_see_supplier(supplier_id)));

-- ---------------------------------------------------------------------------
-- The labels still to make: each line's cartons at the line's pieces, plus the new labels asked for with their own.
-- (Replaces 20261123103000_inventory_labels.sql.)
-- ---------------------------------------------------------------------------

create or replace function private.supplier_labels_needed(p_dispatch uuid)
returns table (product_id uuid, carton_type text, units integer, need integer)
language sql stable security definer set search_path = '' as $$
  with base as (
    select l.product_id, l.carton_type, l.units_per_carton as units,
           greatest(0, l.cartons
             - (select count(*) from public.supplier_cartons c
                where c.dispatch_id = l.dispatch_id and c.product_id = l.product_id and c.carton_type = l.carton_type
                  and not (c.status = 'void' and c.void_reason in ('reprinted', 'pieces changed')))
             - (select count(*) from public.supplier_label_requests r
                where r.dispatch_id = l.dispatch_id and r.product_id = l.product_id and r.carton_type = l.carton_type
                  and r.done_carton is null))::integer as need
    from public.supplier_dispatch_lines l
    where l.dispatch_id = p_dispatch
  ), asked as (
    select r.product_id, r.carton_type, r.units, count(*)::integer as need
    from public.supplier_label_requests r
    where r.dispatch_id = p_dispatch and r.done_carton is null
    group by r.product_id, r.carton_type, r.units
  )
  select x.product_id, x.carton_type, x.units, sum(x.need)::integer
  from (select b.product_id, b.carton_type, b.units, b.need from base b
        union all
        select a.product_id, a.carton_type, a.units, a.need from asked a) x
  group by x.product_id, x.carton_type, x.units
$$;

-- A label with a count other than its line's takes no carton weight. (Replaces 20261123104000_carton_weight.sql.)
create or replace function private.supplier_carton_weight() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.weight_per_carton is null then
    select l.weight_per_carton into new.weight_per_carton from public.supplier_dispatch_lines l
    where l.dispatch_id = new.dispatch_id and l.product_id = new.product_id and l.carton_type = new.carton_type
      and l.units_per_carton = new.units;
  end if;
  return new;
end $$;

-- What the inventory software is asked to print, with the weight only for full-count labels.
-- (Replaces 20261123104000_carton_weight.sql.)
create or replace function public.supplier_labels_claim(p_dispatch uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.supplier_dispatches%rowtype;
  v_vid text;
  v_lines jsonb;
begin
  select * into d from public.supplier_dispatches where id = p_dispatch for update;
  if not found or d.status not in ('planned', 'loading') then
    return null;
  end if;
  if d.labels_run_at > now() - interval '90 seconds' then
    return null;
  end if;
  select w.vrprime_id into v_vid from public.suppliers s join public.warehouses w on w.id = s.warehouse_id where s.id = d.supplier_id;
  select jsonb_agg(jsonb_build_object('product_id', n.product_id, 'sku', m.code, 'carton_type', n.carton_type, 'units', n.units, 'need', n.need,
                                   'weight', (select l.weight_per_carton from public.supplier_dispatch_lines l
                                              where l.dispatch_id = d.id and l.product_id = n.product_id and l.carton_type = n.carton_type
                                                and l.units_per_carton = n.units))
                   order by p.name, n.carton_type, n.units desc)
  into v_lines
  from private.supplier_labels_needed(d.id) n
  join public.supplier_products p on p.id = n.product_id
  join public.master_products m on m.id = p.master_id
  where n.need > 0;
  if v_lines is null then
    update public.supplier_dispatches set labels_error = null where id = d.id;
    return null;
  end if;
  if v_vid is null then
    update public.supplier_dispatches set labels_error = 'the supplier''s warehouse is not one the inventory software lists' where id = d.id;
    return null;
  end if;
  update public.supplier_dispatches set labels_run_at = now(), labels_error = null where id = d.id;
  return jsonb_build_object('warehouse_vid', v_vid, 'lines', v_lines);
end $$;

-- Saves the labels the inventory software printed; a label made for a new count settles its request and records which
-- label it replaces. (Replaces 20261123103000_inventory_labels.sql.)
create or replace function public.supplier_labels_save(p_dispatch uuid, p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d public.supplier_dispatches%rowtype;
  r record;
  v_no integer;
  v_saved integer := 0;
  v_need integer;
  v_req uuid;
  v_old uuid;
  v_new uuid;
begin
  select * into d from public.supplier_dispatches where id = p_dispatch for update;
  if not found or d.status not in ('planned', 'loading') then
    raise exception 'this dispatch takes no more labels' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'too many labels in one go' using errcode = '22023';
  end if;
  select coalesce(max(carton_no), 0) into v_no from public.supplier_cartons where dispatch_id = d.id;
  for r in
    select x.product_id, x.carton_type, x.units, btrim(x.serial) as serial, x.svg
    from jsonb_to_recordset(p_rows) as x(product_id uuid, carton_type text, units integer, serial text, svg text)
  loop
    if r.serial is null or r.serial !~ '^[0-9]{16}$' then
      raise exception 'the inventory software sent a label number that is not 16 digits' using errcode = '22023';
    end if;
    if exists (select 1 from public.supplier_cartons where barcode = r.serial) then
      continue;
    end if;
    select n.need into v_need from private.supplier_labels_needed(d.id) n
    where n.product_id = r.product_id and n.carton_type = r.carton_type and n.units = r.units;
    if coalesce(v_need, 0) < 1 then
      continue;
    end if;
    v_req := null;
    v_old := null;
    select q.id, q.replaces into v_req, v_old from public.supplier_label_requests q
    where q.dispatch_id = d.id and q.product_id = r.product_id and q.carton_type = r.carton_type and q.units = r.units and q.done_carton is null
    order by q.created_at
    limit 1;
    v_no := v_no + 1;
    insert into public.supplier_cartons (supplier_id, dispatch_id, product_id, carton_type, units, carton_no, barcode, label_svg, replaces)
    values (d.supplier_id, d.id, r.product_id, r.carton_type, r.units, v_no, r.serial,
            case when length(r.svg) <= 20000 then r.svg end, v_old)
    returning id into v_new;
    if v_req is not null then
      update public.supplier_label_requests set done_carton = v_new where id = v_req;
    end if;
    v_saved := v_saved + 1;
  end loop;
  -- Keeps the claim alive while a long run is still saving batches.
  update public.supplier_dispatches set labels_run_at = now() where id = d.id;
  return v_saved;
end $$;

-- ---------------------------------------------------------------------------
-- Changing the pieces
-- ---------------------------------------------------------------------------

-- Gives labels not loaded yet a new pieces count: each is voided and a new label with the count is asked for.
-- Returns how many labels were changed (a label that already has that count is left as it is).
create function public.supplier_cartons_repack(p_cartons uuid[], p_units integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d public.supplier_dispatches%rowtype;
  c public.supplier_cartons%rowtype;
  v_dispatch uuid;
  v_n integer := 0;
begin
  if p_cartons is null or cardinality(p_cartons) = 0 or cardinality(p_cartons) > 500 then
    raise exception 'choose the cartons to change' using errcode = '22023';
  end if;
  if p_units is null or p_units < 1 or p_units > 100000 then
    raise exception 'the pieces in a carton must be a whole number from 1' using errcode = '22023';
  end if;
  if (select count(distinct x.dispatch_id) from public.supplier_cartons x where x.id = any (p_cartons)) <> 1 then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select x.dispatch_id into v_dispatch from public.supplier_cartons x where x.id = any (p_cartons) limit 1;
  select * into d from public.supplier_dispatches where id = v_dispatch for update;
  perform private.require_supplier_editor(d.supplier_id, true);
  if d.status not in ('planned', 'loading') then
    raise exception 'this dispatch is closed' using errcode = '22023';
  end if;
  if d.labels_run_at > now() - interval '90 seconds' then
    raise exception 'the labels are being made right now; wait a minute' using errcode = '22023';
  end if;
  for c in select * from public.supplier_cartons x where x.id = any (p_cartons) order by x.carton_no for update loop
    if c.status <> 'issued' then
      raise exception 'label % is loaded or void: only a label not loaded yet can be changed', c.carton_no using errcode = '22023';
    end if;
    if c.units = p_units then
      continue;
    end if;
    update public.supplier_cartons set status = 'void', void_reason = 'pieces changed' where id = c.id;
    insert into public.supplier_label_requests (dispatch_id, supplier_id, product_id, carton_type, units, replaces, created_by)
    values (d.id, d.supplier_id, c.product_id, c.carton_type, p_units, c.id, (select auth.uid()));
    insert into public.supplier_scan_events (supplier_id, dispatch_id, carton_id, barcode, kind, detail, scanned_at, user_id)
    values (d.supplier_id, d.id, c.id, c.barcode, 'reprint', format('pieces changed from %s to %s', c.units, p_units), now(), (select auth.uid()));
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    perform private.call_function('carton-labels', jsonb_build_object('job', 'issue', 'dispatch_id', d.id));
  end if;
  return v_n;
end $$;

-- Voiding the unused labels also gives up new labels asked for and never made: their old labels count as unused.
-- (Replaces 20261123103000_inventory_labels.sql.)
create or replace function public.supplier_dispatch_void_unused(p_dispatch uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d public.supplier_dispatches%rowtype;
  v_count integer;
begin
  select * into d from public.supplier_dispatches where id = p_dispatch for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform private.require_supplier_editor(d.supplier_id, true);
  if d.status not in ('planned', 'loading') then
    raise exception 'this dispatch is closed' using errcode = '22023';
  end if;
  if d.labels_run_at > now() - interval '90 seconds' then
    raise exception 'the labels are being made right now; wait a minute' using errcode = '22023';
  end if;
  with gone as (
    delete from public.supplier_label_requests where dispatch_id = d.id and done_carton is null
    returning replaces
  )
  update public.supplier_cartons set void_reason = 'not used'
  where id in (select g.replaces from gone g) and status = 'void';
  with hit as (
    update public.supplier_cartons set status = 'void', void_reason = 'not used' where dispatch_id = d.id and status = 'issued'
    returning id, barcode
  ), logged as (
    insert into public.supplier_scan_events (supplier_id, dispatch_id, carton_id, barcode, kind, detail, scanned_at, user_id)
    select d.supplier_id, d.id, h.id, h.barcode, 'void', 'not used', now(), (select auth.uid()) from hit h
    returning 1
  )
  select count(*) into v_count from logged;
  -- Labels never made (and reprints never delivered) are given up too.
  update public.supplier_dispatch_lines l
  set cartons = l.cartons - n.need
  from private.supplier_labels_needed(d.id) n
  where l.dispatch_id = d.id and l.product_id = n.product_id and l.carton_type = n.carton_type and n.units = l.units_per_carton
    and n.need > 0 and l.cartons - n.need >= 1;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.supplier_labels_needed(uuid), private.supplier_carton_weight() from public, anon, authenticated;
grant execute on function private.supplier_labels_needed(uuid), private.supplier_carton_weight() to service_role;

revoke all on function public.supplier_cartons_repack(uuid[], integer) from public, anon;
grant execute on function public.supplier_cartons_repack(uuid[], integer) to authenticated, service_role;
