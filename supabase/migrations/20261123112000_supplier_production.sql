-- Phase 3: production, ready stock and how soon goods can be delivered.
--   supplier_recipes       what one unit (or one carton) of a product uses: 1 bottle, 1 trigger, 0.5 litre of chemical,
--                          1 hard carton per carton. Production takes these off the supplies' stock.
--   supplier_production    what was made: product, day, units. More than one entry a day is fine (batches).
--   supplier_stock_counts  a count of the finished goods on hand, which corrects the ready stock.
--
-- Ready stock (finished goods at the supplier's) = made + count corrections - units loaded onto trucks. It counts from
-- the product's first production or count day: cartons loaded before that held goods made before production was
-- entered here, so they are not taken off.
--
-- Who: the supplier's logins (the warehouse person too) enter production and counts; recipes are the supplier's owner's
-- (or VRPRIME's). Nothing here has a price, so VRPRIME's owner and admin see all of it: how much is made each day, what
-- is ready, and so how soon a send plan can be ready. Costs stay with the money tables (20261123111000).
--
-- The factory reset is extended to the new tables: "activity" now also wipes the supplier's production, counts,
-- purchases, payments and costs; "everything" also its supplies, vendors and recipes.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.supplier_recipes (
  product_id uuid not null references public.supplier_products (id) on delete cascade,
  item_id uuid not null references public.supplier_items (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  qty numeric(14, 4) not null check (qty > 0 and qty <= 100000),
  -- 'unit': per unit made (a bottle, a trigger, litres of chemical). 'carton': per full carton (the carton, tape).
  per text not null default 'unit' check (per in ('unit', 'carton')),
  primary key (product_id, item_id)
);
create index supplier_recipes_item_idx on public.supplier_recipes (item_id);
create index supplier_recipes_supplier_idx on public.supplier_recipes (supplier_id);

create table public.supplier_production (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  product_id uuid not null references public.supplier_products (id) on delete cascade,
  made_on date not null,
  units integer not null check (units between 1 and 10000000),
  note text check (note is null or length(note) <= 300),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index supplier_production_supplier_idx on public.supplier_production (supplier_id, made_on desc);
create index supplier_production_product_idx on public.supplier_production (product_id, made_on);
create index supplier_production_created_by_idx on public.supplier_production (created_by);

create table public.supplier_stock_counts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  product_id uuid not null references public.supplier_products (id) on delete cascade,
  counted_on date not null,
  counted integer not null check (counted between 0 and 100000000),
  -- What the count changed: counted minus the ready stock worked out just before it.
  diff integer not null,
  note text check (note is null or length(note) <= 200),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index supplier_stock_counts_product_idx on public.supplier_stock_counts (product_id, counted_on);
create index supplier_stock_counts_supplier_idx on public.supplier_stock_counts (supplier_id);
create index supplier_stock_counts_created_by_idx on public.supplier_stock_counts (created_by);

-- The supplies a production entry used go with it.
alter table public.supplier_item_moves
  add constraint supplier_item_moves_production_fk foreign key (production_id) references public.supplier_production (id) on delete cascade;

do $$
declare
  t text;
begin
  foreach t in array array['supplier_recipes', 'supplier_production', 'supplier_stock_counts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select private.can_see_supplier(supplier_id)))', t || '_select', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Ready stock
-- ---------------------------------------------------------------------------

-- A product's finished goods at the supplier's (see the top of this file). 0 until production or a count is entered.
create function private.ready_units(p_product uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  with f as (
    select least((select min(x.made_on) from public.supplier_production x where x.product_id = p_product),
                 (select min(c.counted_on) from public.supplier_stock_counts c where c.product_id = p_product)) as since
  )
  select case when f.since is null then 0 else
      coalesce((select sum(x.units) from public.supplier_production x where x.product_id = p_product), 0)
    + coalesce((select sum(c.diff) from public.supplier_stock_counts c where c.product_id = p_product), 0)
    - coalesce((select sum(k.units) from public.supplier_cartons k
                join public.supplier_dispatches d on d.id = k.dispatch_id
                where k.product_id = p_product and k.status = 'loaded' and d.status <> 'cancelled'
                  and (coalesce(k.loaded_at, k.created_at) at time zone 'Asia/Kolkata')::date >= f.since), 0)
  end::bigint
  from f
$$;

-- Each product with its ready stock and how much was made lately: the last 7 and 30 days (today included) and on how
-- many days of the last 30. The supplier's logins and VRPRIME's owner and admin.
create function public.supplier_ready_stock(p_supplier uuid)
returns table (product_id uuid, name text, units_per_carton integer, daily_capacity integer, active boolean,
               ready bigint, made_7d bigint, made_30d bigint, days_30d integer, last_made_on date)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not private.can_see_supplier(p_supplier) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select p.id, p.name, p.units_per_carton, p.daily_capacity, p.active,
           private.ready_units(p.id),
           coalesce(sum(x.units) filter (where x.made_on > v_today - 7), 0)::bigint,
           coalesce(sum(x.units) filter (where x.made_on > v_today - 30), 0)::bigint,
           (count(distinct x.made_on) filter (where x.made_on > v_today - 30))::integer,
           max(x.made_on)
    from public.supplier_products p
    left join public.supplier_production x on x.product_id = p.id
    where p.supplier_id = p_supplier
    group by p.id
    order by p.active desc, lower(p.name);
end $$;

-- A count of a product's finished goods: the ready stock becomes what was counted. The supplier's logins (the
-- warehouse person too) or VRPRIME. Returns what the count changed.
create function public.supplier_stock_count(p_product uuid, p_counted integer, p_note text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_supplier uuid;
  v_id uuid;
  v_diff integer;
begin
  select pr.supplier_id into v_supplier from public.supplier_products pr where pr.id = p_product;
  if v_supplier is null then
    raise exception 'that product was not found' using errcode = '22023';
  end if;
  perform private.require_supplier_editor(v_supplier, true);
  if p_counted is null or p_counted < 0 or p_counted > 100000000 then
    raise exception 'the count must be a whole number from 0' using errcode = '22023';
  end if;
  perform 1 from public.supplier_products pr where pr.id = p_product for update;
  -- Saved first with no change, so that what it corrects is worked out from today on if this is the first count.
  insert into public.supplier_stock_counts (supplier_id, product_id, counted_on, counted, diff, note, created_by)
  values (v_supplier, p_product, (now() at time zone 'Asia/Kolkata')::date, p_counted, 0,
          left(nullif(btrim(coalesce(p_note, '')), ''), 200), (select auth.uid()))
  returning id into v_id;
  v_diff := p_counted - private.ready_units(p_product);
  update public.supplier_stock_counts set diff = v_diff where id = v_id;
  return v_diff;
end $$;

-- ---------------------------------------------------------------------------
-- Recipes and production
-- ---------------------------------------------------------------------------

-- Replaces a product's recipe. p_lines: [{item_id, qty, per}], at most 30; an empty list clears it. The supplier's
-- owner or VRPRIME. Production already entered keeps the supplies it took.
create function public.supplier_recipe_save(p_product uuid, p_lines jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_supplier uuid;
  l jsonb;
  v_n integer := 0;
begin
  select pr.supplier_id into v_supplier from public.supplier_products pr where pr.id = p_product;
  if v_supplier is null then
    raise exception 'that product was not found' using errcode = '22023';
  end if;
  perform private.require_supplier_editor(v_supplier);
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 30 then
    raise exception 'a recipe has at most 30 supplies' using errcode = '22023';
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    if not exists (select 1 from public.supplier_items i where i.id = (l ->> 'item_id')::uuid and i.supplier_id = v_supplier) then
      raise exception 'a supply in the recipe was not found' using errcode = '22023';
    end if;
    if (l ->> 'qty')::numeric is null or (l ->> 'qty')::numeric <= 0 or (l ->> 'qty')::numeric > 100000
       or coalesce(l ->> 'per', 'unit') not in ('unit', 'carton') then
      raise exception 'each supply needs a quantity above 0' using errcode = '22023';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_lines)) <> (select count(distinct e ->> 'item_id') from jsonb_array_elements(p_lines) e) then
    raise exception 'a supply is in the recipe twice' using errcode = '22023';
  end if;
  delete from public.supplier_recipes where product_id = p_product;
  insert into public.supplier_recipes (product_id, item_id, supplier_id, qty, per)
  select p_product, (e ->> 'item_id')::uuid, v_supplier, round((e ->> 'qty')::numeric, 4), coalesce(e ->> 'per', 'unit')
  from jsonb_array_elements(p_lines) e;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Adds a production entry or changes one, and takes the supplies it used (by the product's recipe as it is now) off
-- the supplies' stock on that day. p: {id?, product_id, made_on, units, note?}. The supplier's logins or VRPRIME.
create function public.supplier_production_save(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_product uuid := nullif(p ->> 'product_id', '')::uuid;
  v_day date := nullif(p ->> 'made_on', '')::date;
  v_units numeric := nullif(p ->> 'units', '')::numeric;
  v_supplier uuid;
  v_upc integer;
begin
  select pr.supplier_id, pr.units_per_carton into v_supplier, v_upc from public.supplier_products pr where pr.id = v_product;
  if v_supplier is null then
    raise exception 'choose the product' using errcode = '22023';
  end if;
  perform private.require_supplier_editor(v_supplier, true);
  if not private.sensible_day(v_day) or v_day > (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'check the date: production cannot be entered for a day still to come' using errcode = '22023';
  end if;
  if v_units is null or v_units <> trunc(v_units) or v_units < 1 or v_units > 10000000 then
    raise exception 'the units made must be a whole number from 1' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.supplier_production (supplier_id, product_id, made_on, units, note, created_by)
    values (v_supplier, v_product, v_day, v_units::integer, left(nullif(btrim(p ->> 'note'), ''), 300), (select auth.uid()))
    returning id into v_id;
  else
    update public.supplier_production
       set product_id = v_product, made_on = v_day, units = v_units::integer, note = left(nullif(btrim(p ->> 'note'), ''), 300),
           updated_at = now()
     where id = v_id and supplier_id = v_supplier;
    if not found then
      raise exception 'that production entry was not found' using errcode = '22023';
    end if;
  end if;
  delete from public.supplier_item_moves where production_id = v_id;
  insert into public.supplier_item_moves (supplier_id, item_id, qty, reason, production_id, moved_on, created_by)
  select v_supplier, u.item_id, -u.used, 'production', v_id, v_day, (select auth.uid())
  from (select r.item_id, round(case when r.per = 'carton' then r.qty * v_units / v_upc else r.qty * v_units end, 4) as used
        from public.supplier_recipes r where r.product_id = v_product) u
  where u.used > 0;
  return v_id;
end $$;

-- Removes a production entry made by mistake; the supplies it took go back.
create function public.supplier_production_delete(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_supplier uuid;
begin
  select x.supplier_id into v_supplier from public.supplier_production x where x.id = p_id;
  if v_supplier is null then
    raise exception 'that production entry was not found' using errcode = '22023';
  end if;
  perform private.require_supplier_editor(v_supplier, true);
  delete from public.supplier_production where id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- Factory reset, with the new tables. Everything else is as in 20261123109000_factory_reset_where.sql.
-- ---------------------------------------------------------------------------

create or replace function public.factory_reset(p_scope text, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_check text;
  v_counts jsonb := '{}'::jsonb;
  v_photos text[];
  v_n bigint;
begin
  if p_scope is null or p_scope not in ('activity', 'everything') then
    raise exception 'Choose what to wipe' using errcode = '22023';
  end if;
  perform private.require_owner();
  v_check := private.totp_verify(v_uid, btrim(p_code), true);
  if v_check <> 'ok' then
    return jsonb_build_object('ok', false, 'reason', v_check);
  end if;

  -- One reset at a time.
  perform pg_advisory_xact_lock(hashtext('factory_reset'));

  select coalesce(array_agg(name order by name), '{}') into v_photos from storage.objects where bucket_id = 'supplier-photos';

  -- Activity, children before parents.
  delete from public.supplier_send_plan_lines where true;
  delete from public.supplier_send_plans where true;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('send_plans', v_n);
  delete from public.supplier_scan_events where true;
  delete from public.supplier_cartons where true;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('cartons', v_n);
  delete from public.supplier_dispatch_lines where true;
  delete from public.supplier_dispatches where true;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('dispatches', v_n);
  delete from public.supplier_produce_requests where true;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('produce_requests', v_n);
  -- The supplier's own records: supplies used and counted, production, purchases, payments and costs.
  delete from public.supplier_item_moves where true;
  delete from public.supplier_stock_counts where true;
  delete from public.supplier_production where true;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('production', v_n);
  delete from public.supplier_purchases where true;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('purchases', v_n);
  delete from public.supplier_payments where true;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('payments', v_n);
  delete from public.supplier_costs where true;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('costs', v_n);
  delete from public.notifications where true;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('alerts', v_n);

  if p_scope = 'everything' then
    delete from public.supplier_recipes where true;
    delete from public.supplier_items where true;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('supplies', v_n);
    delete from public.supplier_vendors where true;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('vendors', v_n);
    delete from public.supplier_thresholds where true;
    delete from public.supplier_products where true;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('products', v_n);
    -- Removing a supplier login removes its profile, alerts and devices with it. VRPRIME's own logins stay.
    delete from auth.users u using public.profiles p where p.id = u.id and p.role in ('supplier_owner', 'supplier_scanner');
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('supplier_logins', v_n);
    delete from public.suppliers where true;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('suppliers', v_n);
    -- The copy of VRPRIME's stock, warehouses and master SKUs: read again from the inventory software right away.
    delete from public.inventory_stock where true;
    delete from public.master_products where true;
    delete from public.warehouses where true;
    update public.inventory_sync_state set last_ok_at = null, last_error = null, last_products = null, last_pieces = null where id;
    perform private.start_inventory_sync();
  end if;

  v_counts := v_counts || jsonb_build_object('photos', coalesce(array_length(v_photos, 1), 0));
  insert into private.factory_resets (user_id, user_name, scope, counts)
  values (v_uid, (select name from public.profiles where id = v_uid), p_scope, v_counts);

  return jsonb_build_object('ok', true, 'counts', v_counts, 'photos', to_jsonb(v_photos));
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.ready_units(uuid) from public, anon, authenticated;
grant execute on function private.ready_units(uuid) to service_role;

revoke all on function
  public.supplier_ready_stock(uuid), public.supplier_stock_count(uuid, integer, text), public.supplier_recipe_save(uuid, jsonb),
  public.supplier_production_save(jsonb), public.supplier_production_delete(uuid)
  from public, anon;
grant execute on function
  public.supplier_ready_stock(uuid), public.supplier_stock_count(uuid, integer, text), public.supplier_recipe_save(uuid, jsonb),
  public.supplier_production_save(jsonb), public.supplier_production_delete(uuid)
  to authenticated, service_role;
