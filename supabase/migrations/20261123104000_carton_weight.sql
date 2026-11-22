-- Carton weight (kg). Kept on the supplier's product, copied onto each dispatch line when the plan is made (so a later
-- change does not alter a plan already printing), sent to the VRPRIME inventory software with every label it prints
-- (its "weight per carton" on the label, the same field its own print button fills), and printed on the label.
--
-- The product's own weight in the inventory software is never changed: that would be editing a product there.

alter table public.supplier_products add column weight_per_carton numeric(8, 2)
  check (weight_per_carton is null or (weight_per_carton > 0 and weight_per_carton <= 1000));
alter table public.supplier_dispatch_lines add column weight_per_carton numeric(8, 2)
  check (weight_per_carton is null or (weight_per_carton > 0 and weight_per_carton <= 1000));
alter table public.supplier_cartons add column weight_per_carton numeric(8, 2)
  check (weight_per_carton is null or (weight_per_carton > 0 and weight_per_carton <= 1000));

-- A new plan line takes the product's carton weight as it is now.
create function private.supplier_line_weight() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.weight_per_carton is null then
    select p.weight_per_carton into new.weight_per_carton from public.supplier_products p where p.id = new.product_id;
  end if;
  return new;
end $$;
create trigger supplier_line_weight before insert on public.supplier_dispatch_lines
  for each row execute function private.supplier_line_weight();

-- A label takes its line's carton weight.
create function private.supplier_carton_weight() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.weight_per_carton is null then
    select l.weight_per_carton into new.weight_per_carton from public.supplier_dispatch_lines l
    where l.dispatch_id = new.dispatch_id and l.product_id = new.product_id and l.carton_type = new.carton_type;
  end if;
  return new;
end $$;
create trigger supplier_carton_weight before insert on public.supplier_cartons
  for each row execute function private.supplier_carton_weight();

-- Products: the sheet and the form may carry a carton weight.
create or replace function public.supplier_products_save(p_supplier uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_bad text;
  v_added integer := 0;
  v_changed integer := 0;
  r record;
  v_master uuid;
  v_id uuid;
begin
  perform private.require_supplier_editor(p_supplier);
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'there are no products to save' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'too many products in one go (2000 at most)' using errcode = '22023';
  end if;

  select string_agg(distinct btrim(x.master_code), ', ') into v_bad
  from jsonb_to_recordset(p_rows) as x(master_code text)
  where coalesce(btrim(x.master_code), '') <> ''
    and not exists (select 1 from public.master_products m
                    where lower(m.code) = lower(btrim(x.master_code)) or lower(m.name) = lower(btrim(x.master_code)));
  if v_bad is not null then
    raise exception 'these master SKUs are not in VRPRIME: %', left(v_bad, 300) using errcode = '22023';
  end if;

  if exists (select 1 from jsonb_to_recordset(p_rows) as x(name text) group by lower(btrim(x.name)) having count(*) > 1) then
    raise exception 'a product name is in the list twice' using errcode = '22023';
  end if;

  for r in
    select btrim(x.name) as name, nullif(btrim(x.master_code), '') as master_code,
           coalesce(nullif(btrim(x.category), ''), 'other') as category, x.units_per_carton,
           coalesce(nullif(btrim(x.carton_type), ''), 'H') as carton_type, x.daily_capacity, coalesce(x.active, true) as active,
           x.weight_per_carton
    from jsonb_to_recordset(p_rows) as x(name text, master_code text, category text, units_per_carton integer, carton_type text, daily_capacity integer, active boolean, weight_per_carton numeric)
  loop
    if coalesce(r.name, '') = '' or length(r.name) > 200 then
      raise exception 'every product needs a name' using errcode = '22023';
    end if;
    if r.units_per_carton is null or r.units_per_carton < 1 or r.units_per_carton > 100000 then
      raise exception '%: units per carton must be a whole number from 1', r.name using errcode = '22023';
    end if;
    if r.category not in ('kitchen_cleaner', 'repellent', 'other_cleaning', 'other') or r.carton_type not in ('H', 'T') then
      raise exception '%: the category or carton type is not understood', r.name using errcode = '22023';
    end if;
    if r.weight_per_carton is not null and (r.weight_per_carton <= 0 or r.weight_per_carton > 1000) then
      raise exception '%: carton weight must be more than 0 and at most 1000 kg', r.name using errcode = '22023';
    end if;
    v_master := null;
    if r.master_code is not null then
      select m.id into v_master from public.master_products m
      where lower(m.code) = lower(r.master_code) or lower(m.name) = lower(r.master_code)
      order by (lower(m.code) = lower(r.master_code)) desc limit 1;
      if exists (select 1 from public.supplier_products p
                 where p.supplier_id = p_supplier and p.master_id = v_master and lower(btrim(p.name)) <> lower(r.name)) then
        raise exception '%: master SKU % is already linked to another product', r.name, r.master_code using errcode = '22023';
      end if;
    end if;

    select p.id into v_id from public.supplier_products p where p.supplier_id = p_supplier and lower(btrim(p.name)) = lower(r.name);
    if v_id is null then
      insert into public.supplier_products (supplier_id, name, master_id, category, units_per_carton, carton_type, daily_capacity, active, weight_per_carton)
      values (p_supplier, r.name, v_master, r.category, r.units_per_carton, r.carton_type, r.daily_capacity, r.active, round(r.weight_per_carton, 2));
      v_added := v_added + 1;
    else
      update public.supplier_products
      set name = r.name, master_id = coalesce(v_master, master_id), category = r.category, units_per_carton = r.units_per_carton,
          carton_type = r.carton_type, daily_capacity = r.daily_capacity, active = r.active,
          weight_per_carton = round(r.weight_per_carton, 2), updated_at = now()
      where id = v_id;
      v_changed := v_changed + 1;
    end if;
  end loop;
  return jsonb_build_object('added', v_added, 'changed', v_changed);
end $$;

-- The label run: each line says its carton weight, which the function sends with the labels.
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
                                              where l.dispatch_id = d.id and l.product_id = n.product_id and l.carton_type = n.carton_type))
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

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on all functions in schema private to service_role;
grant execute on function private.user_role(), private.is_staff(), private.supplier_role(), private.my_supplier(),
  private.can_see_supplier(uuid), private.is_signed_in(), private.can_see_supplier_path(text) to authenticated;
