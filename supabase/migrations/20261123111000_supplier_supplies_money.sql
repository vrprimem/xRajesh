-- Phase 2: the supplier's supplies and money, in one place.
--   supplier_items        what the supplier buys to make products: bottles, triggers, caps, chemicals, labels, hard and
--                         2-ply cartons, packing. Each with its unit and an optional low-stock level.
--   supplier_item_moves   the supplies ledger: every change to a supply's stock (bought, used by production, counted).
--                         Stock on hand is the sum of its moves. Production adds its moves in phase 3.
--   supplier_vendors      who the supplier buys from.
--   supplier_purchases    what was bought: date, vendor, supply, quantity, rate, GST; received, or still to come.
--   supplier_payments     what the supplier paid each vendor. A vendor's dues are its purchases minus its payments.
--   supplier_costs        labour, hamali, transport, electricity, rent and other costs, as an amount or count x rate.
--
-- Who sees what (decided 23 Nov 2026): money (vendors, purchases, payments, costs) is the supplier owner's alone; not
-- the warehouse person, not VRPRIME. Supplies and their stock carry no prices; the supplier's logins and VRPRIME's owner
-- and admin see them, because they decide how soon goods can be made.
-- As everywhere in the portal, nothing is written to a table directly: the functions below check who is asking first.

-- ---------------------------------------------------------------------------
-- Who may see and change the money
-- ---------------------------------------------------------------------------

-- The supplier's owner login, for its own supplier only. VRPRIME's people are not let in.
create function private.is_money_owner(p_supplier uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_supplier is not null and private.supplier_role() = 'supplier_owner' and private.my_supplier() = p_supplier, false)
$$;

create function private.require_money_owner(p_supplier uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_money_owner(p_supplier) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end $$;

-- A date someone typed: not before 2020 and at most a month ahead.
create function private.sensible_day(p_day date) returns boolean
language sql stable set search_path = '' as $$
  select p_day is not null and p_day >= date '2020-01-01' and p_day <= (now() at time zone 'Asia/Kolkata')::date + 31
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.supplier_items (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  kind text not null default 'other' check (kind in ('bottle', 'trigger', 'cap', 'chemical', 'label', 'carton_hard', 'carton_2ply', 'packing', 'other')),
  unit text not null default 'pcs' check (unit in ('pcs', 'kg', 'litre', 'metre')),
  -- Below this, the supply shows as running low.
  low_level numeric(14, 3) check (low_level is null or low_level >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index supplier_items_name_idx on public.supplier_items (supplier_id, lower(btrim(name)));

create table public.supplier_vendors (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  phone text check (phone is null or length(phone) <= 30),
  note text check (note is null or length(note) <= 300),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index supplier_vendors_name_idx on public.supplier_vendors (supplier_id, lower(btrim(name)));

create table public.supplier_purchases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  vendor_id uuid not null references public.supplier_vendors (id),
  item_id uuid not null references public.supplier_items (id),
  bought_on date not null,
  qty numeric(14, 3) not null check (qty > 0),
  rate numeric(14, 2) not null check (rate >= 0),
  gst_pct numeric(5, 2) not null default 0 check (gst_pct between 0 and 40),
  amount numeric(16, 2) generated always as (round(qty * rate * (1 + gst_pct / 100), 2)) stored,
  bill_no text check (bill_no is null or length(bill_no) <= 60),
  -- Empty while ordered but not received yet; only received supplies are in stock.
  received_on date,
  note text check (note is null or length(note) <= 300),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index supplier_purchases_supplier_idx on public.supplier_purchases (supplier_id, bought_on desc);
create index supplier_purchases_vendor_idx on public.supplier_purchases (vendor_id);
create index supplier_purchases_item_idx on public.supplier_purchases (item_id, bought_on desc);
create index supplier_purchases_created_by_idx on public.supplier_purchases (created_by);

create table public.supplier_item_moves (
  id bigint generated always as identity primary key,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  item_id uuid not null references public.supplier_items (id) on delete cascade,
  qty numeric(16, 4) not null check (qty <> 0),
  reason text not null check (reason in ('purchase', 'production', 'count')),
  purchase_id uuid references public.supplier_purchases (id) on delete cascade,
  -- Phase 3: the production entry that used it.
  production_id uuid,
  note text check (note is null or length(note) <= 200),
  moved_on date not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index supplier_item_moves_item_idx on public.supplier_item_moves (item_id);
create index supplier_item_moves_supplier_idx on public.supplier_item_moves (supplier_id, moved_on desc);
create index supplier_item_moves_purchase_idx on public.supplier_item_moves (purchase_id);
create index supplier_item_moves_production_idx on public.supplier_item_moves (production_id);
create index supplier_item_moves_created_by_idx on public.supplier_item_moves (created_by);

create table public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  vendor_id uuid not null references public.supplier_vendors (id),
  paid_on date not null,
  amount numeric(16, 2) not null check (amount > 0),
  mode text not null default 'cash' check (mode in ('cash', 'upi', 'bank', 'cheque', 'other')),
  reference text check (reference is null or length(reference) <= 60),
  note text check (note is null or length(note) <= 300),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index supplier_payments_supplier_idx on public.supplier_payments (supplier_id, paid_on desc);
create index supplier_payments_vendor_idx on public.supplier_payments (vendor_id);
create index supplier_payments_created_by_idx on public.supplier_payments (created_by);

create table public.supplier_costs (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  spent_on date not null,
  kind text not null check (kind in ('labour', 'hamali', 'transport', 'electricity', 'rent', 'other')),
  -- Optional: how many (workers, cartons, trips) at what rate; the amount is then their product.
  qty numeric(14, 3) check (qty is null or qty > 0),
  rate numeric(14, 2) check (rate is null or rate >= 0),
  amount numeric(16, 2) not null check (amount > 0),
  note text check (note is null or length(note) <= 300),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint supplier_costs_count_rate check ((qty is null) = (rate is null))
);
create index supplier_costs_supplier_idx on public.supplier_costs (supplier_id, spent_on desc);
create index supplier_costs_created_by_idx on public.supplier_costs (created_by);

-- ---------------------------------------------------------------------------
-- Access: read only, and money only for the supplier's owner. No direct writes.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['supplier_items', 'supplier_item_moves', 'supplier_vendors', 'supplier_purchases', 'supplier_payments', 'supplier_costs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
  foreach t in array array['supplier_items', 'supplier_item_moves'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select private.can_see_supplier(supplier_id)))', t || '_select', t);
  end loop;
  foreach t in array array['supplier_vendors', 'supplier_purchases', 'supplier_payments', 'supplier_costs'] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select private.is_money_owner(supplier_id)))', t || '_select', t);
  end loop;
end $$;
revoke all on sequence public.supplier_item_moves_id_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Supplies
-- ---------------------------------------------------------------------------

-- Adds a supply or changes one. p: {id?, name, kind, unit, low_level?, active?}. The supplier's owner, or VRPRIME.
create function public.supplier_item_save(p_supplier uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_name text := btrim(coalesce(p ->> 'name', ''));
  v_kind text := coalesce(nullif(p ->> 'kind', ''), 'other');
  v_unit text := coalesce(nullif(p ->> 'unit', ''), 'pcs');
  v_low numeric := nullif(p ->> 'low_level', '')::numeric;
begin
  perform private.require_supplier_editor(p_supplier);
  if length(v_name) not between 1 and 120 then
    raise exception 'give the supply a name' using errcode = '22023';
  end if;
  if v_kind not in ('bottle', 'trigger', 'cap', 'chemical', 'label', 'carton_hard', 'carton_2ply', 'packing', 'other')
     or v_unit not in ('pcs', 'kg', 'litre', 'metre') or (v_low is not null and v_low < 0) then
    raise exception 'the kind, unit or low-stock level is not understood' using errcode = '22023';
  end if;
  if exists (select 1 from public.supplier_items i
             where i.supplier_id = p_supplier and lower(btrim(i.name)) = lower(v_name) and i.id is distinct from v_id) then
    raise exception 'there is already a supply called %', v_name using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.supplier_items (supplier_id, name, kind, unit, low_level, active)
    values (p_supplier, v_name, v_kind, v_unit, v_low, coalesce((p ->> 'active')::boolean, true))
    returning id into v_id;
  else
    update public.supplier_items
       set name = v_name, kind = v_kind, unit = v_unit, low_level = v_low,
           active = coalesce((p ->> 'active')::boolean, active), updated_at = now()
     where id = v_id and supplier_id = p_supplier;
    if not found then
      raise exception 'that supply was not found' using errcode = '22023';
    end if;
  end if;
  return v_id;
end $$;

-- The supplier's supplies with their stock on hand (the sum of their moves). No prices. Supplier logins and VRPRIME.
create function public.supplier_item_stock(p_supplier uuid)
returns table (id uuid, name text, kind text, unit text, low_level numeric, active boolean, on_hand numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_see_supplier(p_supplier) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select i.id, i.name, i.kind, i.unit, i.low_level, i.active,
           coalesce((select sum(m.qty) from public.supplier_item_moves m where m.item_id = i.id), 0)::numeric
    from public.supplier_items i
    where i.supplier_id = p_supplier
    order by i.active desc, i.kind, lower(i.name);
end $$;

-- A physical count: the stock becomes what was counted, by adding the difference as a move. The supplier's logins
-- (the warehouse person too) or VRPRIME. Returns the difference.
create function public.supplier_item_count(p_item uuid, p_counted numeric, p_note text default null) returns numeric
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
  perform 1 from public.supplier_items i where i.id = p_item for update;
  v_now := coalesce((select sum(m.qty) from public.supplier_item_moves m where m.item_id = p_item), 0);
  v_diff := p_counted - v_now;
  if v_diff <> 0 then
    insert into public.supplier_item_moves (supplier_id, item_id, qty, reason, note, moved_on, created_by)
    values (v_supplier, p_item, v_diff, 'count', left(nullif(btrim(coalesce(p_note, '')), ''), 200),
            (now() at time zone 'Asia/Kolkata')::date, (select auth.uid()));
  end if;
  return v_diff;
end $$;

-- ---------------------------------------------------------------------------
-- Vendors, purchases, payments and costs: the supplier's owner only
-- ---------------------------------------------------------------------------

-- p: {id?, name, phone?, note?, active?}
create function public.supplier_vendor_save(p_supplier uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_name text := btrim(coalesce(p ->> 'name', ''));
begin
  perform private.require_money_owner(p_supplier);
  if length(v_name) not between 1 and 120 then
    raise exception 'give the vendor a name' using errcode = '22023';
  end if;
  if exists (select 1 from public.supplier_vendors v
             where v.supplier_id = p_supplier and lower(btrim(v.name)) = lower(v_name) and v.id is distinct from v_id) then
    raise exception 'there is already a vendor called %', v_name using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.supplier_vendors (supplier_id, name, phone, note, active)
    values (p_supplier, v_name, left(nullif(btrim(p ->> 'phone'), ''), 30), left(nullif(btrim(p ->> 'note'), ''), 300),
            coalesce((p ->> 'active')::boolean, true))
    returning id into v_id;
  else
    update public.supplier_vendors
       set name = v_name, phone = left(nullif(btrim(p ->> 'phone'), ''), 30), note = left(nullif(btrim(p ->> 'note'), ''), 300),
           active = coalesce((p ->> 'active')::boolean, active)
     where id = v_id and supplier_id = p_supplier;
    if not found then
      raise exception 'that vendor was not found' using errcode = '22023';
    end if;
  end if;
  return v_id;
end $$;

-- Each vendor with what was bought from it, what was paid and what is still due (all time).
create function public.supplier_vendor_balances(p_supplier uuid)
returns table (id uuid, name text, phone text, active boolean, bought numeric, paid numeric, due numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_money_owner(p_supplier);
  return query
    select v.id, v.name, v.phone, v.active, b.bought, pd.paid, b.bought - pd.paid
    from public.supplier_vendors v
    cross join lateral (select coalesce(sum(x.amount), 0)::numeric as bought from public.supplier_purchases x where x.vendor_id = v.id) b
    cross join lateral (select coalesce(sum(y.amount), 0)::numeric as paid from public.supplier_payments y where y.vendor_id = v.id) pd
    where v.supplier_id = p_supplier
    order by v.active desc, (b.bought - pd.paid) desc, lower(v.name);
end $$;

-- Adds a purchase or changes one, and keeps its stock move in step: a received purchase adds its quantity to the
-- supply's stock on the day it arrived. p: {id?, vendor_id, item_id, bought_on, qty, rate, gst_pct?, bill_no?,
-- received_on?, note?}
create function public.supplier_purchase_save(p_supplier uuid, p jsonb) returns uuid
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
  delete from public.supplier_item_moves where purchase_id = v_id;
  if v_received is not null then
    insert into public.supplier_item_moves (supplier_id, item_id, qty, reason, purchase_id, moved_on, created_by)
    values (p_supplier, v_item, round(v_qty, 3), 'purchase', v_id, v_received, (select auth.uid()));
  end if;
  return v_id;
end $$;

-- Removes a purchase entered by mistake, and its stock move with it.
create function public.supplier_purchase_delete(p_purchase uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_supplier uuid;
begin
  select x.supplier_id into v_supplier from public.supplier_purchases x where x.id = p_purchase;
  perform private.require_money_owner(v_supplier);
  delete from public.supplier_purchases where id = p_purchase;
end $$;

-- p: {id?, vendor_id, paid_on, amount, mode?, reference?, note?}
create function public.supplier_payment_save(p_supplier uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_vendor uuid := nullif(p ->> 'vendor_id', '')::uuid;
  v_day date := nullif(p ->> 'paid_on', '')::date;
  v_amount numeric := nullif(p ->> 'amount', '')::numeric;
  v_mode text := coalesce(nullif(p ->> 'mode', ''), 'cash');
begin
  perform private.require_money_owner(p_supplier);
  if not exists (select 1 from public.supplier_vendors v where v.id = v_vendor and v.supplier_id = p_supplier) then
    raise exception 'choose the vendor' using errcode = '22023';
  end if;
  if not private.sensible_day(v_day) then
    raise exception 'check the date' using errcode = '22023';
  end if;
  if v_amount is null or v_amount <= 0 or v_amount > 1e11 or v_mode not in ('cash', 'upi', 'bank', 'cheque', 'other') then
    raise exception 'the amount or the way it was paid is not right' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.supplier_payments (supplier_id, vendor_id, paid_on, amount, mode, reference, note, created_by)
    values (p_supplier, v_vendor, v_day, round(v_amount, 2), v_mode, left(nullif(btrim(p ->> 'reference'), ''), 60),
            left(nullif(btrim(p ->> 'note'), ''), 300), (select auth.uid()))
    returning id into v_id;
  else
    update public.supplier_payments
       set vendor_id = v_vendor, paid_on = v_day, amount = round(v_amount, 2), mode = v_mode,
           reference = left(nullif(btrim(p ->> 'reference'), ''), 60), note = left(nullif(btrim(p ->> 'note'), ''), 300)
     where id = v_id and supplier_id = p_supplier;
    if not found then
      raise exception 'that payment was not found' using errcode = '22023';
    end if;
  end if;
  return v_id;
end $$;

create function public.supplier_payment_delete(p_payment uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_supplier uuid;
begin
  select x.supplier_id into v_supplier from public.supplier_payments x where x.id = p_payment;
  perform private.require_money_owner(v_supplier);
  delete from public.supplier_payments where id = p_payment;
end $$;

-- p: {id?, spent_on, kind, amount?, qty?, rate?, note?}. With a count and a rate, the amount is their product.
create function public.supplier_cost_save(p_supplier uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_day date := nullif(p ->> 'spent_on', '')::date;
  v_kind text := nullif(p ->> 'kind', '');
  v_qty numeric := nullif(p ->> 'qty', '')::numeric;
  v_rate numeric := nullif(p ->> 'rate', '')::numeric;
  v_amount numeric := nullif(p ->> 'amount', '')::numeric;
begin
  perform private.require_money_owner(p_supplier);
  if not private.sensible_day(v_day) then
    raise exception 'check the date' using errcode = '22023';
  end if;
  if v_kind is null or v_kind not in ('labour', 'hamali', 'transport', 'electricity', 'rent', 'other') then
    raise exception 'choose what the cost was for' using errcode = '22023';
  end if;
  if (v_qty is null) <> (v_rate is null) or v_qty <= 0 or v_qty > 1e9 or v_rate < 0 or v_rate > 1e9 then
    raise exception 'give both the count and the rate, or neither' using errcode = '22023';
  end if;
  if v_qty is not null then
    v_amount := round(v_qty * v_rate, 2);
  end if;
  if v_amount is null or v_amount <= 0 or v_amount > 1e11 then
    raise exception 'the amount must be above 0' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.supplier_costs (supplier_id, spent_on, kind, qty, rate, amount, note, created_by)
    values (p_supplier, v_day, v_kind, round(v_qty, 3), round(v_rate, 2), round(v_amount, 2), left(nullif(btrim(p ->> 'note'), ''), 300), (select auth.uid()))
    returning id into v_id;
  else
    update public.supplier_costs
       set spent_on = v_day, kind = v_kind, qty = round(v_qty, 3), rate = round(v_rate, 2), amount = round(v_amount, 2),
           note = left(nullif(btrim(p ->> 'note'), ''), 300)
     where id = v_id and supplier_id = p_supplier;
    if not found then
      raise exception 'that cost was not found' using errcode = '22023';
    end if;
  end if;
  return v_id;
end $$;

create function public.supplier_cost_delete(p_cost uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_supplier uuid;
begin
  select x.supplier_id into v_supplier from public.supplier_costs x where x.id = p_cost;
  perform private.require_money_owner(v_supplier);
  delete from public.supplier_costs where id = p_cost;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.is_money_owner(uuid), private.require_money_owner(uuid), private.sensible_day(date) from public, anon, authenticated;
grant execute on function private.is_money_owner(uuid), private.require_money_owner(uuid), private.sensible_day(date) to service_role;
-- The money tables' read rule runs this as the person reading.
grant execute on function private.is_money_owner(uuid) to authenticated;

revoke all on function
  public.supplier_item_save(uuid, jsonb), public.supplier_item_stock(uuid), public.supplier_item_count(uuid, numeric, text),
  public.supplier_vendor_save(uuid, jsonb), public.supplier_vendor_balances(uuid),
  public.supplier_purchase_save(uuid, jsonb), public.supplier_purchase_delete(uuid),
  public.supplier_payment_save(uuid, jsonb), public.supplier_payment_delete(uuid),
  public.supplier_cost_save(uuid, jsonb), public.supplier_cost_delete(uuid)
  from public, anon;
grant execute on function
  public.supplier_item_save(uuid, jsonb), public.supplier_item_stock(uuid), public.supplier_item_count(uuid, numeric, text),
  public.supplier_vendor_save(uuid, jsonb), public.supplier_vendor_balances(uuid),
  public.supplier_purchase_save(uuid, jsonb), public.supplier_purchase_delete(uuid),
  public.supplier_payment_save(uuid, jsonb), public.supplier_payment_delete(uuid),
  public.supplier_cost_save(uuid, jsonb), public.supplier_cost_delete(uuid)
  to authenticated, service_role;
