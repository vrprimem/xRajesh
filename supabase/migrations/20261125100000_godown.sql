-- The godown: the supplier's materials and finished goods on one screen the warehouse staff can use without reading
-- much (src/components/supplier/godown.tsx). Everything is counted in boxes and pieces: a box of 500 bottles, and the
-- loose ones.
--
--   supplier_items           + box_qty: how much one box holds (pieces, or kg, litres); empty when not boxed. The
--                            warehouse person says it, not the owner's supplies form (supplier_item_set_box);
--                            + photo_path;
--                            + simple_name, simple_name_hi, simple_name_mr: what the godown staff call it ("100ml
--                            Bottle"), in English, Hindi and Marathi. Their screen shows these; the owner sees the name
--                            ("19MM 100ML BOSTON WHITE BOTTLE");
--                            + mix_qty, mix_litres: a chemical mixed with water into the liquid the bottles are filled
--                            with: mix_qty of it (in its unit) makes mix_litres litres ("1.5 kg makes 160 L"). Recipes
--                            take such a chemical as the litres of liquid a piece needs (0.25 L a 250ml bottle), and
--                            production takes the chemical off by what it makes
--   supplier_item_moves      + reason 'received': goods in, entered at the godown (the warehouse person too), with the
--                            bill's or challan's photo_path; + weight_kg: what goods in or a count weighed (stickers are
--                            weighed as well as counted)
--   supplier_item_receive    goods in: adds to a material's stock today
--   supplier_item_count      as in 20261123111000, and with what the count weighed
--   supplier_item_set_box    how much one box holds: the warehouse person says, at goods in or a count
--   supplier_item_set_photo  a material's photo (the supplier's owner or VRPRIME)
--   supplier_godown_events   what was entered at the godown lately (goods in, counts, production) and by whom
--   supplier_products        + photo_path: the supplier's own photo of a product, "<supplier>/products/<uuid>.jpg",
--                            shown in place of VRPRIME's photo of its master SKU
--   supplier_product_set_photo  a product's photo (the supplier's owner or VRPRIME)
--   factory_reset            as in 20261123112000, except that a reset of the activity keeps the photos of the
--                            materials and products it keeps (their folders "items" and "products")
--
-- Purchases are money only from now on: a purchase no longer puts anything in stock (goods in does), so the same goods
-- are never counted twice. Stock moves already made by purchases stay as they are.
-- (Replaces supplier_item_save and supplier_purchase_save from 20261123111000, and supplier_production_save from
-- 20261123112000, which are applied live: changed here. Production can now say how many boxes were packed, and those
-- are the cartons it used: 30 boxes of 40 use 30 cartons, not 1,200 over the product's usual carton. And a chemical
-- that makes liquid comes off by what it makes.)

alter table public.supplier_items
  add column box_qty numeric(14, 3) check (box_qty is null or (box_qty > 0 and box_qty <= 1000000000)),
  add column photo_path text check (photo_path is null or length(photo_path) <= 300),
  add column simple_name text check (simple_name is null or length(simple_name) between 1 and 120),
  add column simple_name_hi text check (simple_name_hi is null or length(simple_name_hi) between 1 and 120),
  add column simple_name_mr text check (simple_name_mr is null or length(simple_name_mr) between 1 and 120),
  add column mix_qty numeric(14, 3) check (mix_qty is null or (mix_qty > 0 and mix_qty <= 1000000000)),
  add column mix_litres numeric(14, 3) check (mix_litres is null or (mix_litres > 0 and mix_litres <= 1000000000)),
  add constraint supplier_items_mix_both check ((mix_qty is null) = (mix_litres is null));

alter table public.supplier_products
  add column photo_path text check (photo_path is null or length(photo_path) <= 300);

alter table public.supplier_item_moves drop constraint supplier_item_moves_reason_check;
alter table public.supplier_item_moves
  add constraint supplier_item_moves_reason_check check (reason in ('purchase', 'production', 'count', 'received')),
  add column photo_path text check (photo_path is null or length(photo_path) <= 300),
  add column weight_kg numeric(14, 3) check (weight_kg is null or (weight_kg > 0 and weight_kg <= 1000000000));

-- ---------------------------------------------------------------------------
-- Materials: their boxes, names, mix and photo
-- ---------------------------------------------------------------------------

-- As in 20261123111000, and p may carry: the simple names simple_name, simple_name_hi and simple_name_mr (each on its
-- own; empty clears it); and for a chemical mix_qty and mix_litres, what it makes with water (both, or both empty).
-- Left out, a material keeps what it had. How much a box holds is not here: the warehouse person says that
-- (supplier_item_set_box).
create or replace function public.supplier_item_save(p_supplier uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_name text := btrim(coalesce(p ->> 'name', ''));
  v_kind text := coalesce(nullif(p ->> 'kind', ''), 'other');
  v_unit text := coalesce(nullif(p ->> 'unit', ''), 'pcs');
  v_low numeric := nullif(p ->> 'low_level', '')::numeric;
  v_simple text := nullif(btrim(p ->> 'simple_name'), '');
  v_simple_hi text := nullif(btrim(p ->> 'simple_name_hi'), '');
  v_simple_mr text := nullif(btrim(p ->> 'simple_name_mr'), '');
  v_has_mix boolean := (p ? 'mix_qty') or (p ? 'mix_litres');
  v_mix_qty numeric := round(nullif(p ->> 'mix_qty', '')::numeric, 3);
  v_mix_litres numeric := round(nullif(p ->> 'mix_litres', '')::numeric, 3);
begin
  perform private.require_supplier_editor(p_supplier);
  if length(v_name) not between 1 and 120 then
    raise exception 'give the supply a name' using errcode = '22023';
  end if;
  if v_kind not in ('bottle', 'trigger', 'cap', 'chemical', 'label', 'carton_hard', 'carton_2ply', 'packing', 'other')
     or v_unit not in ('pcs', 'kg', 'litre', 'metre') or (v_low is not null and v_low < 0) then
    raise exception 'the kind, unit or low-stock level is not understood' using errcode = '22023';
  end if;
  if greatest(length(v_simple), length(v_simple_hi), length(v_simple_mr)) > 120 then
    raise exception 'a simple name is at most 120 letters' using errcode = '22023';
  end if;
  if v_has_mix and ((v_mix_qty is null) <> (v_mix_litres is null)
                    or v_mix_qty <= 0 or v_mix_qty > 1000000000 or v_mix_litres <= 0 or v_mix_litres > 1000000000) then
    raise exception 'say how much of it makes how many litres, or leave both empty' using errcode = '22023';
  end if;
  if exists (select 1 from public.supplier_items i
             where i.supplier_id = p_supplier and lower(btrim(i.name)) = lower(v_name) and i.id is distinct from v_id) then
    raise exception 'there is already a supply called %', v_name using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.supplier_items (supplier_id, name, kind, unit, low_level, active,
                                       simple_name, simple_name_hi, simple_name_mr, mix_qty, mix_litres)
    values (p_supplier, v_name, v_kind, v_unit, v_low, coalesce((p ->> 'active')::boolean, true),
            v_simple, v_simple_hi, v_simple_mr, v_mix_qty, v_mix_litres)
    returning id into v_id;
  else
    update public.supplier_items
       set name = v_name, kind = v_kind, unit = v_unit, low_level = v_low,
           active = coalesce((p ->> 'active')::boolean, active),
           mix_qty = case when v_has_mix then v_mix_qty else mix_qty end,
           mix_litres = case when v_has_mix then v_mix_litres else mix_litres end,
           simple_name = case when p ? 'simple_name' then v_simple else simple_name end,
           simple_name_hi = case when p ? 'simple_name_hi' then v_simple_hi else simple_name_hi end,
           simple_name_mr = case when p ? 'simple_name_mr' then v_simple_mr else simple_name_mr end,
           updated_at = now()
     where id = v_id and supplier_id = p_supplier;
    if not found then
      raise exception 'that supply was not found' using errcode = '22023';
    end if;
  end if;
  return v_id;
end $$;

-- A material's photo, already uploaded to "<supplier>/items/<uuid>.jpg"; null takes it off. The supplier's owner or
-- VRPRIME. Returns the photo it replaced (for the app to remove the file), else null.
create function public.supplier_item_set_photo(p_item uuid, p_path text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_supplier uuid;
  v_old text;
begin
  select i.supplier_id, i.photo_path into v_supplier, v_old from public.supplier_items i where i.id = p_item for update;
  if v_supplier is null then
    raise exception 'that supply was not found' using errcode = '22023';
  end if;
  perform private.require_supplier_editor(v_supplier);
  if p_path is not null
     and p_path !~ ('^' || v_supplier::text || '/items/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$') then
    raise exception 'the photo is not in the right place' using errcode = '22023';
  end if;
  update public.supplier_items set photo_path = p_path, updated_at = now() where id = p_item;
  return case when v_old is distinct from p_path then v_old end;
end $$;

-- A product's photo taken by the supplier, already uploaded to "<supplier>/products/<uuid>.jpg"; null takes it off.
-- The portal shows it in place of VRPRIME's photo of the product's master SKU. The supplier's owner or VRPRIME.
-- Returns the photo it replaced (for the app to remove the file), else null.
create function public.supplier_product_set_photo(p_product uuid, p_path text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_supplier uuid;
  v_old text;
begin
  select p.supplier_id, p.photo_path into v_supplier, v_old from public.supplier_products p where p.id = p_product for update;
  if v_supplier is null then
    raise exception 'that product was not found' using errcode = '22023';
  end if;
  perform private.require_supplier_editor(v_supplier);
  if p_path is not null
     and p_path !~ ('^' || v_supplier::text || '/products/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$') then
    raise exception 'the photo is not in the right place' using errcode = '22023';
  end if;
  update public.supplier_products set photo_path = p_path, updated_at = now() where id = p_product;
  return case when v_old is distinct from p_path then v_old end;
end $$;

-- ---------------------------------------------------------------------------
-- Goods in
-- ---------------------------------------------------------------------------

-- What came into the godown, added to the material's stock today. The supplier's logins (the warehouse person too) or
-- VRPRIME. p_photo: the bill's or challan's photo, already uploaded to "<supplier>/goods-in/<uuid>.jpg"; p_kg: what
-- it weighed, when weighed (stickers). Returns the stock on hand after it.
create function public.supplier_item_receive(p_item uuid, p_qty numeric, p_photo text default null, p_kg numeric default null) returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  v_supplier uuid;
begin
  select i.supplier_id into v_supplier from public.supplier_items i where i.id = p_item for update;
  if v_supplier is null then
    raise exception 'that supply was not found' using errcode = '22023';
  end if;
  perform private.require_supplier_editor(v_supplier, true);
  if p_qty is null or p_qty <= 0 or p_qty > 10000000000 then
    raise exception 'enter how much came in: a number above 0' using errcode = '22023';
  end if;
  if p_kg is not null and (p_kg <= 0 or p_kg > 1000000000) then
    raise exception 'the weight is a number of kg above 0, or nothing' using errcode = '22023';
  end if;
  if p_photo is not null
     and p_photo !~ ('^' || v_supplier::text || '/goods-in/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$') then
    raise exception 'the bill photo is not in the right place' using errcode = '22023';
  end if;
  insert into public.supplier_item_moves (supplier_id, item_id, qty, reason, moved_on, created_by, photo_path, weight_kg)
  values (v_supplier, p_item, round(p_qty, 3), 'received', (now() at time zone 'Asia/Kolkata')::date, (select auth.uid()), p_photo,
          round(p_kg, 3));
  return coalesce((select sum(m.qty) from public.supplier_item_moves m where m.item_id = p_item), 0);
end $$;

-- As in 20261123111000 (a physical count: the stock becomes what was counted, by adding the difference as a move),
-- and p_kg: what the count weighed (stickers), kept with the difference. The supplier's logins (the warehouse person
-- too) or VRPRIME. Returns the difference.
drop function public.supplier_item_count(uuid, numeric, text);
create function public.supplier_item_count(p_item uuid, p_counted numeric, p_note text default null, p_kg numeric default null) returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  v_supplier uuid;
  v_now numeric;
  v_diff numeric;
begin
  select i.supplier_id into v_supplier from public.supplier_items i where i.id = p_item;
  if v_supplier is null then
    raise exception 'that supply was not found' using errcode = '22023';
  end if;
  perform private.require_supplier_editor(v_supplier, true);
  if p_counted is null or p_counted < 0 or p_counted > 1e12 then
    raise exception 'the count must be a number from 0' using errcode = '22023';
  end if;
  if p_kg is not null and (p_kg <= 0 or p_kg > 1000000000) then
    raise exception 'the weight is a number of kg above 0, or nothing' using errcode = '22023';
  end if;
  perform 1 from public.supplier_items i where i.id = p_item for update;
  v_now := coalesce((select sum(m.qty) from public.supplier_item_moves m where m.item_id = p_item), 0);
  v_diff := p_counted - v_now;
  if v_diff <> 0 then
    insert into public.supplier_item_moves (supplier_id, item_id, qty, reason, note, moved_on, created_by, weight_kg)
    values (v_supplier, p_item, v_diff, 'count', left(nullif(btrim(coalesce(p_note, '')), ''), 200),
            (now() at time zone 'Asia/Kolkata')::date, (select auth.uid()), round(p_kg, 3));
  end if;
  return v_diff;
end $$;

-- How much one box of a material holds, in its unit; null: counted one by one. The warehouse person says it (at goods
-- in or a count); the supplier's owner and VRPRIME may too.
create function public.supplier_item_set_box(p_item uuid, p_box_qty numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_supplier uuid;
begin
  select i.supplier_id into v_supplier from public.supplier_items i where i.id = p_item for update;
  if v_supplier is null then
    raise exception 'that supply was not found' using errcode = '22023';
  end if;
  perform private.require_supplier_editor(v_supplier, true);
  if p_box_qty is not null and (p_box_qty <= 0 or p_box_qty > 1000000000) then
    raise exception 'say how much one box holds: a number above 0' using errcode = '22023';
  end if;
  update public.supplier_items set box_qty = round(p_box_qty, 3), updated_at = now() where id = p_item;
end $$;

-- As in 20261123112000 (adds a production entry or changes one, and takes the supplies it used off their stock on that
-- day), and p may carry cartons: the boxes the units were packed in. Then what the recipe takes per carton is taken
-- per box packed; left out, per the units over the product's units in a carton, as before. A chemical that makes
-- liquid (mix_qty, mix_litres) is in the recipe as litres of liquid and comes off by what it makes.
create or replace function public.supplier_production_save(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_product uuid := nullif(p ->> 'product_id', '')::uuid;
  v_day date := nullif(p ->> 'made_on', '')::date;
  v_units numeric := nullif(p ->> 'units', '')::numeric;
  v_cartons numeric := nullif(p ->> 'cartons', '')::numeric;
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
  if v_cartons is not null and (v_cartons <> trunc(v_cartons) or v_cartons < 0 or v_cartons > v_units) then
    raise exception 'the boxes packed must be a whole number, no more than the units' using errcode = '22023';
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
  -- A chemical that makes liquid is in the recipe as litres of liquid: it comes off by what it makes (0.25 L of a 1.5 kg
  -- to 160 L chemical is 0.00234 kg).
  from (select r.item_id,
               round((case when r.per = 'carton' then r.qty * coalesce(v_cartons, v_units / v_upc) else r.qty * v_units end)
                     * coalesce(i.mix_qty / i.mix_litres, 1), 4) as used
        from public.supplier_recipes r join public.supplier_items i on i.id = r.item_id
        where r.product_id = v_product) u
  where u.used > 0;
  return v_id;
end $$;

-- As in 20261123111000, but money only: a purchase no longer puts anything in stock (goods in does).
create or replace function public.supplier_purchase_save(p_supplier uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_vendor uuid := nullif(p ->> 'vendor_id', '')::uuid;
  v_item uuid := nullif(p ->> 'item_id', '')::uuid;
  v_bought date := nullif(p ->> 'bought_on', '')::date;
  v_received date := nullif(p ->> 'received_on', '')::date;
  v_qty numeric := nullif(p ->> 'qty', '')::numeric;
  v_rate numeric := nullif(p ->> 'rate', '')::numeric;
  v_gst numeric := coalesce(nullif(p ->> 'gst_pct', '')::numeric, 0);
begin
  perform private.require_money_owner(p_supplier);
  if not exists (select 1 from public.supplier_vendors v where v.id = v_vendor and v.supplier_id = p_supplier) then
    raise exception 'choose the vendor' using errcode = '22023';
  end if;
  if not exists (select 1 from public.supplier_items i where i.id = v_item and i.supplier_id = p_supplier) then
    raise exception 'choose what was bought' using errcode = '22023';
  end if;
  if not private.sensible_day(v_bought) or (v_received is not null and (not private.sensible_day(v_received) or v_received < v_bought)) then
    raise exception 'check the dates' using errcode = '22023';
  end if;
  if v_qty is null or v_qty <= 0 or v_qty > 1e10 or v_rate is null or v_rate < 0 or v_rate > 1e9 or v_gst < 0 or v_gst > 40 then
    raise exception 'the quantity, rate or GST is not right' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.supplier_purchases (supplier_id, vendor_id, item_id, bought_on, qty, rate, gst_pct, bill_no, received_on, note, created_by)
    values (p_supplier, v_vendor, v_item, v_bought, round(v_qty, 3), round(v_rate, 2), round(v_gst, 2),
            left(nullif(btrim(p ->> 'bill_no'), ''), 60), v_received, left(nullif(btrim(p ->> 'note'), ''), 300), (select auth.uid()))
    returning id into v_id;
  else
    update public.supplier_purchases
       set vendor_id = v_vendor, item_id = v_item, bought_on = v_bought, qty = round(v_qty, 3), rate = round(v_rate, 2),
           gst_pct = round(v_gst, 2), bill_no = left(nullif(btrim(p ->> 'bill_no'), ''), 60), received_on = v_received,
           note = left(nullif(btrim(p ->> 'note'), ''), 300)
     where id = v_id and supplier_id = p_supplier;
    if not found then
      raise exception 'that purchase was not found' using errcode = '22023';
    end if;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- What was entered at the godown
-- ---------------------------------------------------------------------------

-- Goods in and counts of materials, and production, over the last p_days days (1: today only), newest first, with who
-- entered each. For a count, qty is what it changed; kg, what goods in or a count weighed. The supplier's logins and
-- VRPRIME.
create function public.supplier_godown_events(p_supplier uuid, p_days integer default 1)
returns table (at timestamptz, who text, kind text, item_id uuid, product_id uuid, qty numeric, photo_path text, kg numeric)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_since date := (now() at time zone 'Asia/Kolkata')::date - (greatest(1, least(coalesce(p_days, 1), 31)) - 1);
begin
  if not private.can_see_supplier(p_supplier) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select e.at, e.who, e.kind, e.item_id, e.product_id, e.qty, e.photo_path, e.kg
    from (
      select m.created_at as at, coalesce(pr.name, '') as who, case when m.reason = 'received' then 'in' else 'count' end as kind,
             m.item_id, null::uuid as product_id, m.qty, m.photo_path, m.weight_kg as kg
      from public.supplier_item_moves m
      left join public.profiles pr on pr.id = m.created_by
      where m.supplier_id = p_supplier and m.moved_on >= v_since and m.reason in ('received', 'count')
      union all
      select x.created_at, coalesce(pr.name, ''), 'made', null::uuid, x.product_id, x.units::numeric, null::text, null::numeric
      from public.supplier_production x
      left join public.profiles pr on pr.id = x.created_by
      where x.supplier_id = p_supplier and x.made_on >= v_since
    ) e
    order by e.at desc
    limit 200;
end $$;

-- ---------------------------------------------------------------------------
-- Factory reset. Everything is as in 20261123112000_supplier_production.sql except the photos it hands back for the
-- app to remove: a reset of the activity keeps the photos of the materials and products, which it keeps.
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

  -- "<supplier>/items/..." and "<supplier>/products/..." are the photos of materials and products.
  select coalesce(array_agg(o.name order by o.name), '{}') into v_photos
  from storage.objects o
  where o.bucket_id = 'supplier-photos'
    and (p_scope = 'everything' or split_part(o.name, '/', 2) not in ('items', 'products'));

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

revoke all on function public.supplier_item_receive(uuid, numeric, text, numeric), public.supplier_item_count(uuid, numeric, text, numeric),
  public.supplier_item_set_box(uuid, numeric), public.supplier_item_set_photo(uuid, text), public.supplier_product_set_photo(uuid, text),
  public.supplier_godown_events(uuid, integer) from public, anon;
grant execute on function public.supplier_item_receive(uuid, numeric, text, numeric), public.supplier_item_count(uuid, numeric, text, numeric),
  public.supplier_item_set_box(uuid, numeric), public.supplier_item_set_photo(uuid, text), public.supplier_product_set_photo(uuid, text),
  public.supplier_godown_events(uuid, integer) to authenticated, service_role;
