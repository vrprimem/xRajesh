-- Carton labels now come from the VRPRIME inventory software, so the warehouse's own scanner knows every carton.
--
-- What the portal asks the inventory software for, and nothing else:
--   * print carton labels for a product at the supplier's warehouse (the same thing its own "print labels" button does)
--   * read a product's carton labels and their state
-- It never records a scan there, never does inbound, never retires a label, never changes a product, a name, stock or a
-- setting. The warehouse keeps using the inventory software exactly as before.
--
-- How a dispatch gets its labels:
--   1. supplier_dispatch_create saves the plan (no labels yet) and asks the Edge Function `carton-labels` for them.
--   2. The function claims the dispatch (supplier_labels_claim), asks the inventory software for the labels still needed,
--      50 at a time, and saves each batch at once (supplier_labels_save), so nothing is lost if it stops half way.
--   3. If it stops, "Try again" (supplier_labels_request) carries on from what is already saved.
--
-- How a carton is known to have arrived: every 30 minutes the function reads the labels of the products on closed
-- dispatches. A label the inventory software no longer shows as "printed" has been scanned in at the warehouse, and
-- the carton is marked received here (supplier_receive_save). A dispatch whose loaded cartons are all received becomes
-- "received" by itself. A closed dispatch with cartons still not scanned in after 2 days is flagged once to VRPRIME and
-- to the supplier's owners. "Mark as received" stays as a manual fallback.

alter table public.supplier_cartons add column label_svg text check (label_svg is null or length(label_svg) <= 20000);
alter table public.supplier_dispatches
  add column labels_run_at timestamptz,
  add column labels_error text check (labels_error is null or length(labels_error) <= 500),
  add column missing_alerted_at timestamptz;

-- The portal no longer makes barcodes of its own.
drop function private.supplier_new_barcode();
drop function private.supplier_check_digit(text);
drop sequence private.supplier_barcode_seq;

-- Labels a line still needs: its planned cartons, less the labels it has. A label voided for a reprint does not count
-- (its replacement is still owed); a label voided as unused does (that carton is not coming).
create function private.supplier_labels_needed(p_dispatch uuid)
returns table (product_id uuid, carton_type text, units integer, need integer)
language sql stable security definer set search_path = '' as $$
  select l.product_id, l.carton_type, l.units_per_carton,
         greatest(0, l.cartons - (select count(*) from public.supplier_cartons c
                                  where c.dispatch_id = l.dispatch_id and c.product_id = l.product_id and c.carton_type = l.carton_type
                                    and not (c.status = 'void' and c.void_reason = 'reprinted')))::integer
  from public.supplier_dispatch_lines l
  where l.dispatch_id = p_dispatch
$$;

-- ---------------------------------------------------------------------------
-- A new plan: saved without labels, then the labels are asked for
-- ---------------------------------------------------------------------------

create or replace function public.supplier_dispatch_create(p_supplier uuid, p_due date, p_note text, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_number integer;
  v_total integer;
  v_bad text;
  r record;
begin
  perform private.require_supplier_editor(p_supplier);
  if p_due is null or p_due < current_date - 7 or p_due > current_date + 365 then
    raise exception 'pick a dispatch date' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 200 then
    raise exception 'add at least one product' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) as x(product_id uuid, cartons integer)
             where x.product_id is null or x.cartons is null or x.cartons < 1 or x.cartons > 5000) then
    raise exception 'every line needs a product and a number of cartons from 1' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) as x(product_id uuid)
             where not exists (select 1 from public.supplier_products p
                               where p.id = x.product_id and p.supplier_id = p_supplier and p.active)) then
    raise exception 'a product in the plan is not one of this supplier''s active products' using errcode = '22023';
  end if;
  -- Labels are printed by the inventory software for its own product, so every product needs its master SKU.
  select string_agg(distinct p.name, ', ') into v_bad
  from jsonb_to_recordset(p_lines) as x(product_id uuid)
  join public.supplier_products p on p.id = x.product_id
  where p.master_id is null;
  if v_bad is not null then
    raise exception 'set the VRPRIME master SKU first for: %', left(v_bad, 300) using errcode = '22023';
  end if;
  select sum(x.cartons) into v_total from jsonb_to_recordset(p_lines) as x(cartons integer);
  if v_total > 10000 then
    raise exception 'a dispatch holds 10,000 cartons at most' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('supplier_dispatch:' || p_supplier::text));
  select coalesce(max(d.number), 0) + 1 into v_number from public.supplier_dispatches d where d.supplier_id = p_supplier;

  insert into public.supplier_dispatches (supplier_id, number, due_on, note, created_by)
  values (p_supplier, v_number, p_due, nullif(left(btrim(coalesce(p_note, '')), 500), ''), (select auth.uid()))
  returning id into v_id;

  for r in
    select p.id as product_id, coalesce(nullif(btrim(x.carton_type), ''), p.carton_type) as carton_type,
           coalesce(x.units_per_carton, p.units_per_carton) as units, sum(x.cartons)::integer as cartons
    from jsonb_to_recordset(p_lines) as x(product_id uuid, carton_type text, units_per_carton integer, cartons integer)
    join public.supplier_products p on p.id = x.product_id
    group by 1, 2, 3
  loop
    if r.carton_type not in ('H', 'T') or r.units < 1 or r.units > 100000 then
      raise exception 'a line has a carton type or units per carton that is not understood' using errcode = '22023';
    end if;
    insert into public.supplier_dispatch_lines (dispatch_id, product_id, carton_type, units_per_carton, cartons)
    values (v_id, r.product_id, r.carton_type, r.units, r.cartons);
  end loop;

  perform private.call_function('carton-labels', jsonb_build_object('job', 'issue', 'dispatch_id', v_id));
  return v_id;
end $$;

-- "Try again": asks for the labels still missing. The supplier's owner or warehouse person, or VRPRIME.
create function public.supplier_labels_request(p_dispatch uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.supplier_dispatches%rowtype;
begin
  select * into d from public.supplier_dispatches where id = p_dispatch;
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
  perform private.call_function('carton-labels', jsonb_build_object('job', 'issue', 'dispatch_id', d.id));
end $$;

-- ---------------------------------------------------------------------------
-- For the Edge Function only (service role)
-- ---------------------------------------------------------------------------

-- Takes the dispatch for one run and says what to ask for: the warehouse's id in the inventory software and, per line,
-- the product's code and how many labels are still needed. NULL when there is nothing to do or another run has it.
create function public.supplier_labels_claim(p_dispatch uuid) returns jsonb
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
  select jsonb_agg(jsonb_build_object('product_id', n.product_id, 'sku', m.code, 'carton_type', n.carton_type, 'units', n.units, 'need', n.need)
                   order by p.name, n.carton_type)
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

-- Saves one batch of labels the inventory software has just printed: [{product_id, carton_type, units, serial, svg}].
-- A serial already saved is skipped, and never more labels than the line still needs. Returns how many were saved.
create function public.supplier_labels_save(p_dispatch uuid, p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d public.supplier_dispatches%rowtype;
  r record;
  v_no integer;
  v_saved integer := 0;
  v_need integer;
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
    v_no := v_no + 1;
    insert into public.supplier_cartons (supplier_id, dispatch_id, product_id, carton_type, units, carton_no, barcode, label_svg)
    values (d.supplier_id, d.id, r.product_id, r.carton_type, r.units, v_no, r.serial,
            case when length(r.svg) <= 20000 then r.svg end);
    v_saved := v_saved + 1;
  end loop;
  -- Keeps the claim alive while a long run is still saving batches.
  update public.supplier_dispatches set labels_run_at = now() where id = d.id;
  return v_saved;
end $$;

-- The run is over: frees the dispatch and keeps the reason if it stopped early.
create function public.supplier_labels_done(p_dispatch uuid, p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.supplier_dispatches
  set labels_run_at = null, labels_error = left(nullif(btrim(coalesce(p_error, '')), ''), 500)
  where id = p_dispatch;
$$;

-- What to look at for arrivals: per warehouse and product, the cartons that were loaded on a closed dispatch and are
-- not yet known to have arrived.
create function public.supplier_receive_plan() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('warehouse_vid', x.vid, 'sku', x.code, 'serials', x.serials)), '[]'::jsonb)
  from (
    select w.vrprime_id as vid, m.code, jsonb_agg(c.barcode) as serials
    from public.supplier_cartons c
    join public.supplier_dispatches d on d.id = c.dispatch_id and d.status = 'closed'
    join public.suppliers s on s.id = c.supplier_id
    join public.warehouses w on w.id = s.warehouse_id
    join public.supplier_products p on p.id = c.product_id
    join public.master_products m on m.id = p.master_id
    where c.status = 'loaded' and c.inbound_status is null and w.vrprime_id is not null
    group by w.vrprime_id, m.code
  ) x
$$;

-- Marks cartons as arrived (the inventory software shows them scanned in), completes dispatches whose loaded cartons
-- have all arrived, and flags closed dispatches with cartons still missing after 2 days, once each.
create function public.supplier_receive_save(p_serials jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_marked integer := 0;
  v_done integer := 0;
  v_flagged integer := 0;
  d record;
  u uuid;
begin
  if jsonb_typeof(p_serials) is distinct from 'array' or jsonb_array_length(p_serials) > 20000 then
    raise exception 'too many cartons in one go' using errcode = '22023';
  end if;
  with hit as (
    update public.supplier_cartons c
    set inbound_status = 'received', inbound_at = now()
    from public.supplier_dispatches sd
    where sd.id = c.dispatch_id and sd.status = 'closed' and c.status = 'loaded' and c.inbound_status is null
      and c.barcode in (select jsonb_array_elements_text(p_serials))
    returning 1
  )
  select count(*) into v_marked from hit;

  with fin as (
    update public.supplier_dispatches sd
    set status = 'received', received_at = now()
    where sd.status = 'closed'
      and not exists (select 1 from public.supplier_cartons c where c.dispatch_id = sd.id and c.status = 'loaded' and c.inbound_status is null)
    returning 1
  )
  select count(*) into v_done from fin;

  for d in
    select sd.id, sd.supplier_id, sd.number, s.name as supplier,
           (select count(*) from public.supplier_cartons c where c.dispatch_id = sd.id and c.status = 'loaded' and c.inbound_status is null) as missing,
           (select count(*) from public.supplier_cartons c where c.dispatch_id = sd.id and c.status = 'loaded') as loaded
    from public.supplier_dispatches sd
    join public.suppliers s on s.id = sd.supplier_id
    where sd.status = 'closed' and sd.missing_alerted_at is null and sd.closed_at < now() - interval '2 days'
  loop
    update public.supplier_dispatches set missing_alerted_at = now() where id = d.id;
    for u in select id from public.profiles where active and role in ('owner', 'admin') loop
      insert into public.notifications (user_id, kind, url, title, body)
      values (u, 'supplier_missing', '/suppliers/' || d.supplier_id::text,
              d.supplier || ', dispatch ' || d.number || ': ' || d.missing || ' of ' || d.loaded || ' cartons not scanned in',
              'Closed more than 2 days ago. Check with the warehouse, or mark the dispatch received if they arrived.');
    end loop;
    for u in select id from public.profiles where active and role = 'supplier_owner' and supplier_id = d.supplier_id loop
      insert into public.notifications (user_id, kind, url, title, body)
      values (u, 'supplier_missing', '/supplier/dispatches',
              'Dispatch ' || d.number || ': ' || d.missing || ' of ' || d.loaded || ' cartons not yet scanned in at VRPRIME',
              'It was closed more than 2 days ago.');
    end loop;
    v_flagged := v_flagged + 1;
  end loop;
  return jsonb_build_object('marked', v_marked, 'dispatches_received', v_done, 'flagged', v_flagged);
end $$;

-- ---------------------------------------------------------------------------
-- Changed to fit
-- ---------------------------------------------------------------------------

-- A damaged label: voids it and asks the inventory software for one new label for the same carton.
drop function public.supplier_carton_reprint(uuid);
create function public.supplier_carton_reprint(p_carton uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.supplier_cartons%rowtype;
  d public.supplier_dispatches%rowtype;
begin
  select * into c from public.supplier_cartons where id = p_carton for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform private.require_supplier_editor(c.supplier_id, true);
  select * into d from public.supplier_dispatches where id = c.dispatch_id for update;
  if d.status not in ('planned', 'loading') then
    raise exception 'this dispatch is closed' using errcode = '22023';
  end if;
  if c.status <> 'issued' then
    raise exception 'only a label that is not loaded and not void can be reprinted' using errcode = '22023';
  end if;
  update public.supplier_cartons set status = 'void', void_reason = 'reprinted' where id = c.id;
  insert into public.supplier_scan_events (supplier_id, dispatch_id, carton_id, barcode, kind, detail, scanned_at, user_id)
  values (c.supplier_id, c.dispatch_id, c.id, c.barcode, 'reprint', 'a new label was asked for', now(), (select auth.uid()));
  perform private.call_function('carton-labels', jsonb_build_object('job', 'issue', 'dispatch_id', d.id));
end $$;

-- Closing also waits for labels that are still being made.
create or replace function public.supplier_dispatch_close(p_dispatch uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.supplier_dispatches%rowtype;
  v_left integer;
  v_loaded integer;
  v_owed integer;
begin
  select * into d from public.supplier_dispatches where id = p_dispatch for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform private.require_supplier_editor(d.supplier_id, true);
  if d.status not in ('planned', 'loading') then
    raise exception 'this dispatch is already closed' using errcode = '22023';
  end if;
  select count(*) filter (where status = 'issued'), count(*) filter (where status = 'loaded') into v_left, v_loaded
  from public.supplier_cartons where dispatch_id = d.id;
  select coalesce(sum(need), 0) into v_owed from private.supplier_labels_needed(d.id);
  if v_loaded = 0 then
    raise exception 'no carton has been scanned yet' using errcode = '22023';
  end if;
  if v_owed > 0 then
    raise exception '% labels have not been made yet; press Try again on the dispatch, or wait', v_owed using errcode = '22023';
  end if;
  if v_left > 0 then
    raise exception '% labels are not scanned and not void', v_left using errcode = '22023';
  end if;
  if d.vehicle_photo_path is null then
    raise exception 'attach the photo of the loaded vehicle first' using errcode = '22023';
  end if;
  update public.supplier_dispatches set status = 'closed', closed_at = now(), closed_by = (select auth.uid()) where id = d.id;
end $$;

-- Voiding the unused labels also gives up the labels that were never made: the plan's count comes down to what exists.
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
  where l.dispatch_id = d.id and l.product_id = n.product_id and l.carton_type = n.carton_type and n.need > 0 and l.cartons - n.need >= 1;
  return v_count;
end $$;

-- The manual fallback marks the dispatch's cartons as arrived too.
create or replace function public.supplier_dispatch_receive(p_dispatch uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  update public.supplier_dispatches set status = 'received', received_at = now(), received_by = (select auth.uid())
  where id = p_dispatch and status = 'closed';
  if not found then
    raise exception 'only a closed dispatch can be marked received' using errcode = '22023';
  end if;
  update public.supplier_cartons set inbound_status = 'received', inbound_at = now()
  where dispatch_id = p_dispatch and status = 'loaded' and inbound_status is null;
end $$;

-- On their way: loaded on a closed dispatch and not yet scanned in.
create or replace function private.supplier_in_transit(p_supplier uuid) returns table (product_id uuid, units bigint)
language sql stable security definer set search_path = '' as $$
  select c.product_id, sum(c.units)::bigint
  from public.supplier_cartons c
  join public.supplier_dispatches d on d.id = c.dispatch_id
  where c.supplier_id = p_supplier and c.status = 'loaded' and c.inbound_status is null and d.status = 'closed'
  group by c.product_id
$$;

-- ---------------------------------------------------------------------------
-- Grants and schedule
-- ---------------------------------------------------------------------------

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on all functions in schema private to service_role;
grant execute on function private.user_role(), private.is_staff(), private.supplier_role(), private.my_supplier(),
  private.can_see_supplier(uuid), private.is_signed_in(), private.can_see_supplier_path(text) to authenticated;

revoke all on function public.supplier_labels_request(uuid), public.supplier_carton_reprint(uuid) from public, anon;
grant execute on function public.supplier_labels_request(uuid), public.supplier_carton_reprint(uuid) to authenticated, service_role;

revoke all on function public.supplier_labels_claim(uuid), public.supplier_labels_save(uuid, jsonb), public.supplier_labels_done(uuid, text),
  public.supplier_receive_plan(), public.supplier_receive_save(jsonb) from public, anon, authenticated;
grant execute on function public.supplier_labels_claim(uuid), public.supplier_labels_save(uuid, jsonb), public.supplier_labels_done(uuid, text),
  public.supplier_receive_plan(), public.supplier_receive_save(jsonb) to service_role;

-- 15 minutes after each stock sync: look for cartons the warehouse has scanned in.
select cron.schedule('supplier-receive-check', '15,45 * * * *',
  $$select private.call_function('carton-labels', '{"job":"receive"}'::jsonb)$$);
