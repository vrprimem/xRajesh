-- Carton weight at dispatch time. Each label carries its carton's weight (printed on it, and sent to the inventory
-- software with it), and a carton's weight follows its pieces: a box of 12 weighs less than a box of 24. So:
--   - a new dispatch takes a weight per line: the product's, unless the supplier weighs the cartons and changes it;
--   - changing a carton's pieces can give its weight too, and a carton can get a new weight on its own. Either way it
--     gets a new label (as a reprint does), because the old one shows the old figures.
-- A pending new label keeps its weight in supplier_label_requests; all pending labels of one product, carton type and
-- pieces share one weight, so the inventory software prints them alike.
-- (Replaces supplier_dispatch_create from 20261123103000, and supplier_labels_claim, supplier_labels_save and
-- supplier_cartons_repack from 20261123114000.)

alter table public.supplier_label_requests
  add column weight numeric(8, 2) check (weight is null or (weight > 0 and weight <= 1000));

-- The labels still to make, as in 20261123114000; a label voided for a new weight is replaced as well.
create or replace function private.supplier_labels_needed(p_dispatch uuid)
returns table (product_id uuid, carton_type text, units integer, need integer)
language sql stable security definer set search_path = '' as $$
  with base as (
    select l.product_id, l.carton_type, l.units_per_carton as units,
           greatest(0, l.cartons
             - (select count(*) from public.supplier_cartons c
                where c.dispatch_id = l.dispatch_id and c.product_id = l.product_id and c.carton_type = l.carton_type
                  and not (c.status = 'void' and c.void_reason in ('reprinted', 'pieces changed', 'weight changed')))
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

-- ---------------------------------------------------------------------------
-- A new dispatch: lines may carry their carton weight
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
  if exists (select 1 from jsonb_to_recordset(p_lines) as x(weight_per_carton numeric)
             where x.weight_per_carton is not null and (x.weight_per_carton <= 0 or x.weight_per_carton > 1000)) then
    raise exception 'a carton weight must be above 0 and at most 1,000 kg' using errcode = '22023';
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
  -- One line per product and carton type: the same one twice with other pieces or another weight cannot be told apart.
  if exists (select 1
             from jsonb_to_recordset(p_lines) as x(product_id uuid, carton_type text, units_per_carton integer, weight_per_carton numeric)
             join public.supplier_products p on p.id = x.product_id
             group by p.id, coalesce(nullif(btrim(x.carton_type), ''), p.carton_type)
             having count(distinct coalesce(x.units_per_carton, p.units_per_carton)) > 1
                 or count(distinct round(x.weight_per_carton, 2)) > 1) then
    raise exception 'a product is on two lines with the same carton type but other pieces or weight: keep one line' using errcode = '22023';
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
           coalesce(x.units_per_carton, p.units_per_carton) as units, sum(x.cartons)::integer as cartons,
           max(round(x.weight_per_carton, 2)) as weight
    from jsonb_to_recordset(p_lines) as x(product_id uuid, carton_type text, units_per_carton integer, cartons integer, weight_per_carton numeric)
    join public.supplier_products p on p.id = x.product_id
    group by 1, 2, 3
  loop
    if r.carton_type not in ('H', 'T') or r.units < 1 or r.units > 100000 then
      raise exception 'a line has a carton type or units per carton that is not understood' using errcode = '22023';
    end if;
    -- With no weight given, the line takes the product's (private.supplier_line_weight).
    insert into public.supplier_dispatch_lines (dispatch_id, product_id, carton_type, units_per_carton, cartons, weight_per_carton)
    values (v_id, r.product_id, r.carton_type, r.units, r.cartons, r.weight);
  end loop;

  perform private.call_function('carton-labels', jsonb_build_object('job', 'issue', 'dispatch_id', v_id));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- What the inventory software is asked to print: a pending new label's own weight, else the line's for a full count
-- ---------------------------------------------------------------------------

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
                                   'weight', coalesce(
                                     (select q.weight from public.supplier_label_requests q
                                      where q.dispatch_id = d.id and q.product_id = n.product_id and q.carton_type = n.carton_type
                                        and q.units = n.units and q.done_carton is null and q.weight is not null
                                      order by q.created_at limit 1),
                                     (select l.weight_per_carton from public.supplier_dispatch_lines l
                                      where l.dispatch_id = d.id and l.product_id = n.product_id and l.carton_type = n.carton_type
                                        and l.units_per_carton = n.units)))
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

-- Saves the printed labels; a label made for a request takes the request's weight (when it has one).
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
  v_weight numeric;
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
    v_weight := null;
    select q.id, q.replaces, q.weight into v_req, v_old, v_weight from public.supplier_label_requests q
    where q.dispatch_id = d.id and q.product_id = r.product_id and q.carton_type = r.carton_type and q.units = r.units and q.done_carton is null
    order by q.created_at
    limit 1;
    v_no := v_no + 1;
    insert into public.supplier_cartons (supplier_id, dispatch_id, product_id, carton_type, units, carton_no, barcode, label_svg, replaces, weight_per_carton)
    values (d.supplier_id, d.id, r.product_id, r.carton_type, r.units, v_no, r.serial,
            case when length(r.svg) <= 20000 then r.svg end, v_old, v_weight)
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
-- New pieces, a new weight, or both: a new label for each carton not loaded yet
-- ---------------------------------------------------------------------------

drop function public.supplier_cartons_repack(uuid[], integer);

-- p_weight: the carton weight in kg for the new labels; null for none given (then a full-count carton takes its line's
-- weight and any other count goes without). A label that would come out the same is left as it is. Returns how many
-- labels were changed. (p_weight has a default so a call with pieces alone, as before, still works.)
create function public.supplier_cartons_repack(p_cartons uuid[], p_units integer, p_weight numeric default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d public.supplier_dispatches%rowtype;
  c public.supplier_cartons%rowtype;
  v_dispatch uuid;
  v_weight numeric := round(p_weight, 2);
  v_line_units integer;
  v_line_weight numeric;
  v_n integer := 0;
begin
  if p_cartons is null or cardinality(p_cartons) = 0 or cardinality(p_cartons) > 500 then
    raise exception 'choose the cartons to change' using errcode = '22023';
  end if;
  if p_units is null or p_units < 1 or p_units > 100000 then
    raise exception 'the pieces in a carton must be a whole number from 1' using errcode = '22023';
  end if;
  if p_weight is not null and (p_weight <= 0 or p_weight > 1000) then
    raise exception 'a carton weight must be above 0 and at most 1,000 kg' using errcode = '22023';
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
    select l.units_per_carton, l.weight_per_carton into v_line_units, v_line_weight
    from public.supplier_dispatch_lines l
    where l.dispatch_id = d.id and l.product_id = c.product_id and l.carton_type = c.carton_type;
    if c.units = p_units
       and c.weight_per_carton is not distinct from coalesce(v_weight, case when p_units = v_line_units then v_line_weight end) then
      continue;
    end if;
    update public.supplier_cartons set status = 'void', void_reason = case when c.units <> p_units then 'pieces changed' else 'weight changed' end
    where id = c.id;
    insert into public.supplier_label_requests (dispatch_id, supplier_id, product_id, carton_type, units, weight, replaces, created_by)
    values (d.id, d.supplier_id, c.product_id, c.carton_type, p_units, v_weight, c.id, (select auth.uid()));
    -- Every pending new label of this product, carton type and count prints with the same weight.
    update public.supplier_label_requests set weight = v_weight
    where dispatch_id = d.id and product_id = c.product_id and carton_type = c.carton_type and units = p_units and done_carton is null;
    insert into public.supplier_scan_events (supplier_id, dispatch_id, carton_id, barcode, kind, detail, scanned_at, user_id)
    values (d.supplier_id, d.id, c.id, c.barcode, 'reprint',
            left(format('changed from %s pieces%s to %s pieces%s', c.units,
                        coalesce(', ' || c.weight_per_carton || ' kg', ''), p_units, coalesce(', ' || v_weight || ' kg', '')), 200),
            now(), (select auth.uid()));
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    perform private.call_function('carton-labels', jsonb_build_object('job', 'issue', 'dispatch_id', d.id));
  end if;
  return v_n;
end $$;

revoke all on function public.supplier_cartons_repack(uuid[], integer, numeric) from public, anon;
grant execute on function public.supplier_cartons_repack(uuid[], integer, numeric) to authenticated, service_role;
