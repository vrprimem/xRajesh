-- A dispatch can take more products after it is made, and VRPRIME can delete a send plan for good.
--
--   supplier_dispatch_add_lines  the supplier's owner (or VRPRIME) adds products, or more cartons of a product already
--                                on it, while the dispatch is still being loaded. Their labels are made by the inventory
--                                software exactly as for a new dispatch.
--   supplier_plan_delete         VRPRIME's owner or admin only deletes a send plan, whatever its status, with its lines.
--                                A dispatch made from it stays as it is. If it was still to be made, the supplier's
--                                owners are told to stop. Dispatches themselves are never deleted.

-- ---------------------------------------------------------------------------
-- More products on a dispatch that is still being loaded
-- ---------------------------------------------------------------------------

-- p_lines as for supplier_dispatch_create: [{product_id, cartons, units_per_carton?, weight_per_carton?}]. A product
-- already on the dispatch gets its cartons added to its line, with the line's pieces and weight (others are refused:
-- one line per product). Returns the number of cartons added.
create function public.supplier_dispatch_add_lines(p_dispatch uuid, p_lines jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  d public.supplier_dispatches%rowtype;
  l public.supplier_dispatch_lines%rowtype;
  v_bad text;
  v_total integer;
  v_added integer := 0;
  r record;
begin
  select * into d from public.supplier_dispatches where id = p_dispatch for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform private.require_supplier_editor(d.supplier_id);
  if d.status not in ('planned', 'loading') then
    raise exception 'this dispatch is closed: make a new one for these products' using errcode = '22023';
  end if;
  if d.labels_run_at > now() - interval '90 seconds' then
    raise exception 'the labels are being made right now; wait a minute' using errcode = '22023';
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
                               where p.id = x.product_id and p.supplier_id = d.supplier_id and p.active)) then
    raise exception 'a product in the plan is not one of this supplier''s active products' using errcode = '22023';
  end if;
  select string_agg(distinct p.name, ', ') into v_bad
  from jsonb_to_recordset(p_lines) as x(product_id uuid)
  join public.supplier_products p on p.id = x.product_id
  where p.master_id is null;
  if v_bad is not null then
    raise exception 'set the VRPRIME master SKU first for: %', left(v_bad, 300) using errcode = '22023';
  end if;
  if exists (select 1
             from jsonb_to_recordset(p_lines) as x(product_id uuid, carton_type text, units_per_carton integer, weight_per_carton numeric)
             join public.supplier_products p on p.id = x.product_id
             group by p.id, coalesce(nullif(btrim(x.carton_type), ''), p.carton_type)
             having count(distinct coalesce(x.units_per_carton, p.units_per_carton)) > 1
                 or count(distinct round(x.weight_per_carton, 2)) > 1) then
    raise exception 'a product is on two lines with the same carton type but other pieces or weight: keep one line' using errcode = '22023';
  end if;

  for r in
    select p.id as product_id, p.name, coalesce(nullif(btrim(x.carton_type), ''), p.carton_type) as carton_type,
           coalesce(x.units_per_carton, p.units_per_carton) as units, sum(x.cartons)::integer as cartons,
           max(round(x.weight_per_carton, 2)) as weight
    from jsonb_to_recordset(p_lines) as x(product_id uuid, carton_type text, units_per_carton integer, cartons integer, weight_per_carton numeric)
    join public.supplier_products p on p.id = x.product_id
    group by 1, 2, 3, 4
  loop
    if r.carton_type not in ('H', 'T') or r.units < 1 or r.units > 100000 then
      raise exception 'a line has a carton type or units per carton that is not understood' using errcode = '22023';
    end if;
    select * into l from public.supplier_dispatch_lines x
    where x.dispatch_id = d.id and x.product_id = r.product_id and x.carton_type = r.carton_type
    for update;
    if found then
      -- Its labels show the pieces and weight, so more cartons of it are added alike.
      if l.units_per_carton <> r.units or (r.weight is not null and l.weight_per_carton is distinct from r.weight) then
        raise exception '% is already on this dispatch with % pieces a carton%: add more of it with the same pieces and weight',
          r.name, l.units_per_carton, coalesce(' and ' || l.weight_per_carton || ' kg', '') using errcode = '22023';
      end if;
      if l.cartons + r.cartons > 5000 then
        raise exception 'a product holds 5,000 cartons at most on one dispatch' using errcode = '22023';
      end if;
      update public.supplier_dispatch_lines set cartons = cartons + r.cartons
      where dispatch_id = d.id and product_id = r.product_id and carton_type = r.carton_type;
    else
      -- With no weight given, the line takes the product's (private.supplier_line_weight).
      insert into public.supplier_dispatch_lines (dispatch_id, product_id, carton_type, units_per_carton, cartons, weight_per_carton)
      values (d.id, r.product_id, r.carton_type, r.units, r.cartons, r.weight);
    end if;
    v_added := v_added + r.cartons;
  end loop;

  select sum(x.cartons) into v_total from public.supplier_dispatch_lines x where x.dispatch_id = d.id;
  if v_total > 10000 then
    raise exception 'a dispatch holds 10,000 cartons at most' using errcode = '22023';
  end if;

  perform private.call_function('carton-labels', jsonb_build_object('job', 'issue', 'dispatch_id', d.id));
  return v_added;
end $$;

-- ---------------------------------------------------------------------------
-- Deleting a send plan for good: VRPRIME only
-- ---------------------------------------------------------------------------

create function public.supplier_plan_delete(p_plan uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  pl public.supplier_send_plans%rowtype;
  u uuid;
begin
  perform private.require_staff();
  select * into pl from public.supplier_send_plans where id = p_plan for update;
  if not found then
    raise exception 'this plan is no longer there' using errcode = '22023';
  end if;
  -- Its lines go with it; a dispatch made from it does not.
  delete from public.supplier_send_plans where id = pl.id;
  -- A plan still to be made: the supplier's owners are told to stop, as when VRPRIME cancels one.
  if pl.status not in ('dispatched', 'cancelled') then
    for u in select p.id from public.profiles p where p.active and p.role = 'supplier_owner' and p.supplier_id = pl.supplier_id loop
      insert into public.notifications (user_id, kind, url, title, body)
      values (u, 'supplier_plan', '/supplier', 'VRPRIME deleted send plan ' || pl.number, 'Do not make it any more.');
    end loop;
  end if;
end $$;

revoke all on function public.supplier_dispatch_add_lines(uuid, jsonb), public.supplier_plan_delete(uuid) from public, anon;
grant execute on function public.supplier_dispatch_add_lines(uuid, jsonb), public.supplier_plan_delete(uuid) to authenticated, service_role;
