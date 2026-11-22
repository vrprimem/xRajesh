-- Supplier portal: products, dispatches with one label per carton, scan-out, VRPRIME stock and "Produce now".
--
--   supplier_products          the supplier's products, each linked to a VRPRIME master SKU
--   supplier_dispatches        a dispatch plan: planned -> loading -> closed -> received (or cancelled)
--   supplier_dispatch_lines    what the plan holds: product, carton type, units per carton, cartons
--   supplier_cartons           one row per label, with its barcode: issued -> loaded, or void
--   supplier_scan_events       every scan and label action, with the phone's time, the save time and who
--   supplier_thresholds        VRPRIME's minimum stock per product
--   supplier_produce_requests  "Produce now": raised when stock + in transit is under the minimum, and the supplier's answer
--
-- Who reads: VRPRIME owner and admin read every supplier's rows; a supplier login reads its own supplier's rows only.
-- Nobody writes a table from the app: every change goes through a function below, and each checks the caller itself.
--
-- Not here yet (they wait on the inventory software): matching Bhiwandi's inbound scans carton by carton, QC rejects,
-- and the mismatch / not-received alerts. Until then VRPRIME marks a closed dispatch as received by hand, which takes it
-- out of "in transit". supplier_cartons.inbound_status and inbound_at are ready for the match.
--
-- The barcode on a label is a 16-digit number made here ('9' + 14 digits + a check digit), printed as Code 128. Whether
-- the inventory software accepts these numbers is still to be agreed with its developer; private.supplier_new_barcode()
-- is the one place that makes them.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  -- The VRPRIME master SKU (which is the inventory software's product). Empty until linked: no stock is shown without it.
  master_id uuid references public.master_products (id) on delete set null,
  category text not null default 'other' check (category in ('kitchen_cleaner', 'repellent', 'other_cleaning', 'other')),
  units_per_carton integer not null check (units_per_carton between 1 and 100000),
  carton_type text not null default 'H' check (carton_type in ('H', 'T')),
  daily_capacity integer check (daily_capacity is null or daily_capacity between 0 and 10000000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index supplier_products_name_idx on public.supplier_products (supplier_id, lower(btrim(name)));
create unique index supplier_products_master_idx on public.supplier_products (supplier_id, master_id) where master_id is not null;
create index supplier_products_master_fk_idx on public.supplier_products (master_id);

create table public.supplier_dispatches (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  -- 1, 2, 3 ... per supplier. Printed on every label.
  number integer not null check (number >= 1),
  status text not null default 'planned' check (status in ('planned', 'loading', 'closed', 'received', 'cancelled')),
  due_on date not null,
  note text check (note is null or length(note) <= 500),
  vehicle_photo_path text check (vehicle_photo_path is null or length(vehicle_photo_path) <= 300),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  closed_by uuid references public.profiles (id) on delete set null,
  closed_at timestamptz,
  received_by uuid references public.profiles (id) on delete set null,
  received_at timestamptz,
  unique (supplier_id, number)
);
create index supplier_dispatches_status_idx on public.supplier_dispatches (supplier_id, status, due_on);
create index supplier_dispatches_created_by_idx on public.supplier_dispatches (created_by);
create index supplier_dispatches_closed_by_idx on public.supplier_dispatches (closed_by);
create index supplier_dispatches_received_by_idx on public.supplier_dispatches (received_by);

create table public.supplier_dispatch_lines (
  dispatch_id uuid not null references public.supplier_dispatches (id) on delete cascade,
  product_id uuid not null references public.supplier_products (id),
  carton_type text not null check (carton_type in ('H', 'T')),
  units_per_carton integer not null check (units_per_carton between 1 and 100000),
  cartons integer not null check (cartons between 1 and 5000),
  primary key (dispatch_id, product_id, carton_type)
);
create index supplier_dispatch_lines_product_idx on public.supplier_dispatch_lines (product_id);

create table public.supplier_cartons (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  dispatch_id uuid not null references public.supplier_dispatches (id) on delete cascade,
  product_id uuid not null references public.supplier_products (id),
  carton_type text not null check (carton_type in ('H', 'T')),
  units integer not null check (units between 1 and 100000),
  -- The running number within the dispatch, printed on the label. A reprint gets the next number.
  carton_no integer not null check (carton_no >= 1),
  barcode text not null unique check (barcode ~ '^[0-9]{16}$'),
  status text not null default 'issued' check (status in ('issued', 'loaded', 'void')),
  loaded_at timestamptz,
  loaded_by uuid references public.profiles (id) on delete set null,
  void_reason text check (void_reason is null or length(void_reason) <= 200),
  -- The carton whose label this one replaces (a reprint).
  replaces uuid references public.supplier_cartons (id) on delete set null,
  -- For the match with Bhiwandi's inbound scans, once the inventory software lists them.
  inbound_status text check (inbound_status is null or inbound_status in ('received', 'rejected')),
  inbound_at timestamptz,
  created_at timestamptz not null default now(),
  unique (dispatch_id, carton_no)
);
create index supplier_cartons_dispatch_idx on public.supplier_cartons (dispatch_id, status);
create index supplier_cartons_supplier_idx on public.supplier_cartons (supplier_id);
create index supplier_cartons_product_idx on public.supplier_cartons (product_id);
create index supplier_cartons_loaded_by_idx on public.supplier_cartons (loaded_by);
create index supplier_cartons_replaces_idx on public.supplier_cartons (replaces);

create table public.supplier_scan_events (
  id bigint generated always as identity primary key,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  dispatch_id uuid not null references public.supplier_dispatches (id) on delete cascade,
  carton_id uuid references public.supplier_cartons (id) on delete set null,
  barcode text not null check (length(barcode) <= 64),
  kind text not null check (kind in ('load', 'refused', 'void', 'reprint')),
  detail text check (detail is null or length(detail) <= 200),
  -- When the phone read it (a scan made with no signal is saved later).
  scanned_at timestamptz not null,
  saved_at timestamptz not null default now(),
  user_id uuid references public.profiles (id) on delete set null
);
create index supplier_scan_events_dispatch_idx on public.supplier_scan_events (dispatch_id, saved_at desc);
create index supplier_scan_events_supplier_idx on public.supplier_scan_events (supplier_id);
create index supplier_scan_events_carton_idx on public.supplier_scan_events (carton_id);
create index supplier_scan_events_user_idx on public.supplier_scan_events (user_id);

create table public.supplier_thresholds (
  product_id uuid primary key references public.supplier_products (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  -- Alert when stock at the warehouse + units in transit is under this.
  min_units integer not null check (min_units between 1 and 100000000),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index supplier_thresholds_supplier_idx on public.supplier_thresholds (supplier_id);
create index supplier_thresholds_updated_by_idx on public.supplier_thresholds (updated_by);

create table public.supplier_produce_requests (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  product_id uuid not null references public.supplier_products (id) on delete cascade,
  -- open: raised, no answer yet. accepted / in_production / dispatched: the supplier's answer. cleared: stock is back
  -- above the minimum.
  status text not null default 'open' check (status in ('open', 'accepted', 'in_production', 'dispatched', 'cleared')),
  stock_units integer not null,
  in_transit_units integer not null,
  min_units integer not null,
  suggested_units integer not null,
  raised_at timestamptz not null default now(),
  responded_by uuid references public.profiles (id) on delete set null,
  responded_at timestamptz,
  cleared_at timestamptz
);
-- One live request per product.
create unique index supplier_produce_live_idx on public.supplier_produce_requests (product_id) where status <> 'cleared';
create index supplier_produce_supplier_idx on public.supplier_produce_requests (supplier_id, status);
create index supplier_produce_responded_by_idx on public.supplier_produce_requests (responded_by);

-- ---------------------------------------------------------------------------
-- Access: read your own supplier's rows (VRPRIME owner and admin: all). No direct writes.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['supplier_products', 'supplier_dispatches', 'supplier_cartons', 'supplier_scan_events',
                           'supplier_thresholds', 'supplier_produce_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select private.can_see_supplier(supplier_id)))', t || '_select', t);
  end loop;
end $$;

alter table public.supplier_dispatch_lines enable row level security;
revoke all on public.supplier_dispatch_lines from public, anon, authenticated;
grant select on public.supplier_dispatch_lines to authenticated;
grant all on public.supplier_dispatch_lines to service_role;
create policy supplier_dispatch_lines_select on public.supplier_dispatch_lines for select to authenticated
  using (exists (select 1 from public.supplier_dispatches d
                 where d.id = dispatch_id and (select private.can_see_supplier(d.supplier_id))));

revoke all on sequence public.supplier_scan_events_id_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

-- Who may change this supplier's data. p_scanner_too: the warehouse person as well (scanning, label actions).
-- VRPRIME owner and admin always may.
create function private.require_supplier_editor(p_supplier uuid, p_scanner_too boolean default false) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or p_supplier is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if private.is_staff() then
    return;
  end if;
  if p_supplier = private.my_supplier()
     and (private.supplier_role() = 'supplier_owner' or (p_scanner_too and private.supplier_role() = 'supplier_scanner')) then
    return;
  end if;
  raise exception 'not allowed' using errcode = '42501';
end $$;

-- ---------------------------------------------------------------------------
-- Barcodes
-- ---------------------------------------------------------------------------

create sequence private.supplier_barcode_seq as bigint start 1;

-- The check digit of a 15-digit number (weights 3,1,3,1 ... from the right, as on retail barcodes).
create function private.supplier_check_digit(p_digits text) returns integer
language sql immutable set search_path = '' as $$
  select (10 - (sum(substr(p_digits, i, 1)::integer * case when (length(p_digits) - i) % 2 = 0 then 3 else 1 end) % 10)) % 10
  from generate_series(1, length(p_digits)) as i
$$;

create function private.supplier_new_barcode() returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_body text := '9' || lpad(nextval('private.supplier_barcode_seq')::text, 14, '0');
begin
  return v_body || private.supplier_check_digit(v_body)::text;
end $$;

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------

-- Adds or updates products by name. Rows: [{name, master_code?, category?, units_per_carton, carton_type?, daily_capacity?,
-- active?}]. master_code is the VRPRIME master SKU code (or its exact name); an unknown one refuses the whole file and
-- names it. Never removes a product.
create function public.supplier_products_save(p_supplier uuid, p_rows jsonb) returns jsonb
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
           coalesce(nullif(btrim(x.carton_type), ''), 'H') as carton_type, x.daily_capacity, coalesce(x.active, true) as active
    from jsonb_to_recordset(p_rows) as x(name text, master_code text, category text, units_per_carton integer, carton_type text, daily_capacity integer, active boolean)
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
      insert into public.supplier_products (supplier_id, name, master_id, category, units_per_carton, carton_type, daily_capacity, active)
      values (p_supplier, r.name, v_master, r.category, r.units_per_carton, r.carton_type, r.daily_capacity, r.active);
      v_added := v_added + 1;
    else
      update public.supplier_products
      set name = r.name, master_id = coalesce(v_master, master_id), category = r.category, units_per_carton = r.units_per_carton,
          carton_type = r.carton_type, daily_capacity = r.daily_capacity, active = r.active, updated_at = now()
      where id = v_id;
      v_changed := v_changed + 1;
    end if;
  end loop;
  return jsonb_build_object('added', v_added, 'changed', v_changed);
end $$;

-- ---------------------------------------------------------------------------
-- Dispatches and labels
-- ---------------------------------------------------------------------------

-- Creates a dispatch plan and issues its labels: exactly one per planned carton. Lines: [{product_id, carton_type?,
-- units_per_carton?, cartons}]; type and units default to the product's.
create function public.supplier_dispatch_create(p_supplier uuid, p_due date, p_note text, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_number integer;
  v_no integer := 0;
  v_total integer;
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
  select sum(x.cartons) into v_total from jsonb_to_recordset(p_lines) as x(cartons integer);
  if v_total > 10000 then
    raise exception 'a dispatch holds 10,000 cartons at most' using errcode = '22023';
  end if;

  -- One dispatch number at a time per supplier.
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
    group by 1, 2, 3, p.name
    order by p.name, 2
  loop
    if r.carton_type not in ('H', 'T') or r.units < 1 or r.units > 100000 then
      raise exception 'a line has a carton type or units per carton that is not understood' using errcode = '22023';
    end if;
    insert into public.supplier_dispatch_lines (dispatch_id, product_id, carton_type, units_per_carton, cartons)
    values (v_id, r.product_id, r.carton_type, r.units, r.cartons);
    insert into public.supplier_cartons (supplier_id, dispatch_id, product_id, carton_type, units, carton_no, barcode)
    select p_supplier, v_id, r.product_id, r.carton_type, r.units, v_no + g, private.supplier_new_barcode()
    from generate_series(1, r.cartons) as g;
    v_no := v_no + r.cartons;
  end loop;
  return v_id;
end $$;

-- Saves scans from the loading screen. Scans: [{barcode, at}] ("at" is the phone's time). Safe to send twice: a carton
-- already loaded answers "already". Returns one answer per scan, in order:
--   loaded | already | void | other_dispatch | unknown | closed
create function public.supplier_scan(p_dispatch uuid, p_scans jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d public.supplier_dispatches%rowtype;
  c public.supplier_cartons%rowtype;
  s record;
  v_out jsonb := '[]'::jsonb;
  v_result text;
  v_at timestamptz;
begin
  select * into d from public.supplier_dispatches where id = p_dispatch for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform private.require_supplier_editor(d.supplier_id, true);
  if jsonb_typeof(p_scans) is distinct from 'array' or jsonb_array_length(p_scans) > 500 then
    raise exception 'too many scans in one go' using errcode = '22023';
  end if;

  for s in select btrim(x.barcode) as barcode, x.at from jsonb_to_recordset(p_scans) as x(barcode text, at timestamptz) loop
    if coalesce(s.barcode, '') = '' or length(s.barcode) > 64 then
      continue;
    end if;
    -- A phone's clock can be wrong: never later than now, never older than 7 days.
    v_at := greatest(least(coalesce(s.at, now()), now()), now() - interval '7 days');
    select * into c from public.supplier_cartons where barcode = s.barcode;
    if not found or c.supplier_id <> d.supplier_id then
      -- Another supplier's label is "unknown" too: nothing about it is told.
      v_result := 'unknown';
      c := null;
    elsif c.dispatch_id <> d.id then
      v_result := 'other_dispatch';
    elsif d.status not in ('planned', 'loading') then
      v_result := 'closed';
    elsif c.status = 'void' then
      v_result := 'void';
    elsif c.status = 'loaded' then
      v_result := 'already';
    else
      update public.supplier_cartons set status = 'loaded', loaded_at = v_at, loaded_by = (select auth.uid()) where id = c.id;
      v_result := 'loaded';
    end if;
    if v_result <> 'already' then
      insert into public.supplier_scan_events (supplier_id, dispatch_id, carton_id, barcode, kind, detail, scanned_at, user_id)
      values (d.supplier_id, d.id, c.id, s.barcode, case when v_result = 'loaded' then 'load' else 'refused' end,
              case when v_result = 'loaded' then null else v_result end, v_at, (select auth.uid()));
    end if;
    v_out := v_out || jsonb_build_object('barcode', s.barcode, 'result', v_result, 'carton_no', c.carton_no);
  end loop;

  if d.status = 'planned' and exists (select 1 from public.supplier_cartons where dispatch_id = d.id and status = 'loaded') then
    update public.supplier_dispatches set status = 'loading' where id = d.id;
  end if;
  return v_out;
end $$;

-- Voids a label that will not be used (an unused label, or a damaged one). A loaded carton cannot be voided.
create function public.supplier_carton_void(p_carton uuid, p_reason text) returns void
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
  select * into d from public.supplier_dispatches where id = c.dispatch_id;
  if d.status not in ('planned', 'loading') then
    raise exception 'this dispatch is closed' using errcode = '22023';
  end if;
  if c.status = 'loaded' then
    raise exception 'this carton is already loaded' using errcode = '22023';
  end if;
  if c.status = 'void' then
    return;
  end if;
  update public.supplier_cartons set status = 'void', void_reason = left(coalesce(nullif(btrim(p_reason), ''), 'not used'), 200) where id = c.id;
  insert into public.supplier_scan_events (supplier_id, dispatch_id, carton_id, barcode, kind, detail, scanned_at, user_id)
  values (c.supplier_id, c.dispatch_id, c.id, c.barcode, 'void', left(coalesce(nullif(btrim(p_reason), ''), 'not used'), 200), now(), (select auth.uid()));
end $$;

-- Voids every label of the dispatch that was never loaded (the "unused labels" step before closing).
create function public.supplier_dispatch_void_unused(p_dispatch uuid) returns integer
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
  with hit as (
    update public.supplier_cartons set status = 'void', void_reason = 'not used' where dispatch_id = d.id and status = 'issued'
    returning id, barcode
  ), logged as (
    insert into public.supplier_scan_events (supplier_id, dispatch_id, carton_id, barcode, kind, detail, scanned_at, user_id)
    select d.supplier_id, d.id, h.id, h.barcode, 'void', 'not used', now(), (select auth.uid()) from hit h
    returning 1
  )
  select count(*) into v_count from logged;
  return v_count;
end $$;

-- A damaged label: voids it and issues a new one for the same carton, with the next running number. Returns the new id.
create function public.supplier_carton_reprint(p_carton uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  c public.supplier_cartons%rowtype;
  d public.supplier_dispatches%rowtype;
  v_new uuid;
  v_no integer;
  v_code text;
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
  select max(carton_no) + 1 into v_no from public.supplier_cartons where dispatch_id = c.dispatch_id;
  v_code := private.supplier_new_barcode();
  update public.supplier_cartons set status = 'void', void_reason = 'reprinted' where id = c.id;
  insert into public.supplier_cartons (supplier_id, dispatch_id, product_id, carton_type, units, carton_no, barcode, replaces)
  values (c.supplier_id, c.dispatch_id, c.product_id, c.carton_type, c.units, v_no, v_code, c.id)
  returning id into v_new;
  insert into public.supplier_scan_events (supplier_id, dispatch_id, carton_id, barcode, kind, detail, scanned_at, user_id)
  values (c.supplier_id, c.dispatch_id, c.id, c.barcode, 'reprint', 'new label ' || v_no, now(), (select auth.uid()));
  return v_new;
end $$;

-- The photo of the loaded vehicle. The file is already in the supplier-photos bucket under "<supplier>/<dispatch>/".
create function public.supplier_dispatch_set_photo(p_dispatch uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.supplier_dispatches%rowtype;
begin
  select * into d from public.supplier_dispatches where id = p_dispatch for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform private.require_supplier_editor(d.supplier_id, true);
  if d.status not in ('planned', 'loading') then
    raise exception 'this dispatch is closed' using errcode = '22023';
  end if;
  if p_path is null or p_path !~ ('^' || d.supplier_id::text || '/' || d.id::text || '/[0-9a-f-]{36}\.jpg$') then
    raise exception 'that photo does not belong to this dispatch' using errcode = '22023';
  end if;
  update public.supplier_dispatches set vehicle_photo_path = p_path where id = d.id;
end $$;

-- Closes the dispatch and locks it. Refused until: at least one carton is loaded, no label is left unaccounted for
-- (every one is loaded or void), and the vehicle photo is attached.
create function public.supplier_dispatch_close(p_dispatch uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.supplier_dispatches%rowtype;
  v_left integer;
  v_loaded integer;
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
  if v_loaded = 0 then
    raise exception 'no carton has been scanned yet' using errcode = '22023';
  end if;
  if v_left > 0 then
    raise exception '% labels are not scanned and not void', v_left using errcode = '22023';
  end if;
  if d.vehicle_photo_path is null then
    raise exception 'attach the photo of the loaded vehicle first' using errcode = '22023';
  end if;
  update public.supplier_dispatches set status = 'closed', closed_at = now(), closed_by = (select auth.uid()) where id = d.id;
end $$;

-- Cancels a plan nothing was loaded on. Its labels become void.
create function public.supplier_dispatch_cancel(p_dispatch uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  d public.supplier_dispatches%rowtype;
begin
  select * into d from public.supplier_dispatches where id = p_dispatch for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform private.require_supplier_editor(d.supplier_id);
  if d.status <> 'planned' or exists (select 1 from public.supplier_cartons where dispatch_id = d.id and status = 'loaded') then
    raise exception 'only a plan with nothing loaded can be cancelled' using errcode = '22023';
  end if;
  update public.supplier_cartons set status = 'void', void_reason = 'dispatch cancelled' where dispatch_id = d.id and status = 'issued';
  update public.supplier_dispatches set status = 'cancelled' where id = d.id;
end $$;

-- VRPRIME marks a closed dispatch as received: its units stop counting as "in transit". By hand until Bhiwandi's
-- inbound scans can be matched.
create function public.supplier_dispatch_receive(p_dispatch uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  update public.supplier_dispatches set status = 'received', received_at = now(), received_by = (select auth.uid())
  where id = p_dispatch and status = 'closed';
  if not found then
    raise exception 'only a closed dispatch can be marked received' using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- VRPRIME stock, thresholds and "Produce now"
-- ---------------------------------------------------------------------------

-- Units on their way: loaded cartons of dispatches that are closed and not yet received.
create function private.supplier_in_transit(p_supplier uuid) returns table (product_id uuid, units bigint)
language sql stable security definer set search_path = '' as $$
  select c.product_id, sum(c.units)::bigint
  from public.supplier_cartons c
  join public.supplier_dispatches d on d.id = c.dispatch_id
  where c.supplier_id = p_supplier and c.status = 'loaded' and d.status = 'closed'
  group by c.product_id
$$;

-- The stock view: this supplier's products with the stock of their master SKU at the supplier's VRPRIME warehouse,
-- units in transit and the minimum. The only way a supplier login reaches VRPRIME's stock: its own products, one
-- warehouse, nothing else. stock_units is NULL for a product with no master SKU linked.
create function public.supplier_stock(p_supplier uuid)
returns table (product_id uuid, name text, master_code text, units_per_carton integer, active boolean,
               stock_units integer, in_transit_units integer, min_units integer, synced_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.can_see_supplier(p_supplier) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select p.id, p.name, m.code, p.units_per_carton, p.active,
         case when m.id is null then null else coalesce(st.pieces, 0) end,
         coalesce(t.units, 0)::integer, th.min_units,
         (select last_ok_at from public.inventory_sync_state where id)
  from public.supplier_products p
  join public.suppliers s on s.id = p.supplier_id
  left join public.master_products m on m.id = p.master_id
  left join public.inventory_stock st on st.code = m.code and st.warehouse_id = s.warehouse_id
  left join private.supplier_in_transit(p_supplier) t on t.product_id = p.id
  left join public.supplier_thresholds th on th.product_id = p.id
  where p.supplier_id = p_supplier
  order by p.name;
end $$;

-- VRPRIME owner and admin set (or, with NULL, remove) a product's minimum.
create function public.supplier_threshold_set(p_product uuid, p_min integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_supplier uuid;
begin
  perform private.require_staff();
  select supplier_id into v_supplier from public.supplier_products where id = p_product;
  if v_supplier is null then
    raise exception 'that product was not found' using errcode = '22023';
  end if;
  if p_min is null then
    delete from public.supplier_thresholds where product_id = p_product;
    return;
  end if;
  if p_min < 1 or p_min > 100000000 then
    raise exception 'the minimum must be a whole number from 1' using errcode = '22023';
  end if;
  insert into public.supplier_thresholds (product_id, supplier_id, min_units, updated_by)
  values (p_product, v_supplier, p_min, (select auth.uid()))
  on conflict (product_id) do update set min_units = excluded.min_units, updated_by = excluded.updated_by, updated_at = now();
end $$;

-- Raises and clears "Produce now". Run after each stock sync (cron below) and safe to run any time.
--   below the minimum, no live request  -> a new request, and one notification to the supplier's owners
--   back at or above the minimum        -> the live request is cleared
-- Suggested quantity: enough to bring stock + in transit up to twice the minimum, rounded up to full cartons.
-- Nothing is raised while the stock sync has not worked for a day (old numbers would raise false alarms).
create function private.supplier_produce_check() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s record;
  r record;
  v_raised integer := 0;
  v_names text;
  v_count integer;
  u uuid;
begin
  if not exists (select 1 from public.inventory_sync_state where id and last_ok_at > now() - interval '24 hours') then
    return 0;
  end if;
  for s in select id, warehouse_id from public.suppliers where active loop
    v_names := null;
    v_count := 0;
    for r in
      select p.id as product_id, p.name, p.units_per_carton, th.min_units,
             coalesce(st.pieces, 0) as stock, coalesce(t.units, 0)::integer as transit,
             (select q.id from public.supplier_produce_requests q where q.product_id = p.id and q.status <> 'cleared') as live
      from public.supplier_products p
      join public.supplier_thresholds th on th.product_id = p.id
      join public.master_products m on m.id = p.master_id
      left join public.inventory_stock st on st.code = m.code and st.warehouse_id = s.warehouse_id
      left join private.supplier_in_transit(s.id) t on t.product_id = p.id
      where p.supplier_id = s.id and p.active
    loop
      if r.stock + r.transit < r.min_units and r.live is null then
        insert into public.supplier_produce_requests (supplier_id, product_id, stock_units, in_transit_units, min_units, suggested_units)
        values (s.id, r.product_id, r.stock, r.transit, r.min_units,
                (ceil((2 * r.min_units - r.stock - r.transit)::numeric / r.units_per_carton) * r.units_per_carton)::integer);
        v_count := v_count + 1;
        if v_count <= 3 then
          v_names := coalesce(v_names || ', ', '') || r.name;
        end if;
      elsif r.stock + r.transit >= r.min_units and r.live is not null then
        update public.supplier_produce_requests set status = 'cleared', cleared_at = now() where id = r.live;
      end if;
    end loop;
    if v_count > 0 then
      for u in select id from public.profiles where active and role = 'supplier_owner' and supplier_id = s.id loop
        insert into public.notifications (user_id, kind, url, title, body)
        values (u, 'supplier_produce', '/supplier',
                case when v_count = 1 then 'Produce now: 1 product is low at VRPRIME' else 'Produce now: ' || v_count || ' products are low at VRPRIME' end,
                v_names || case when v_count > 3 then ' and ' || (v_count - 3) || ' more' else '' end);
      end loop;
      v_raised := v_raised + v_count;
    end if;
  end loop;
  return v_raised;
end $$;

-- The supplier's answer to a request: accepted, in_production or dispatched.
create function public.supplier_produce_respond(p_request uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  q public.supplier_produce_requests%rowtype;
begin
  select * into q from public.supplier_produce_requests where id = p_request for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform private.require_supplier_editor(q.supplier_id);
  if p_status not in ('accepted', 'in_production', 'dispatched') or q.status = 'cleared' then
    raise exception 'that answer is not understood' using errcode = '22023';
  end if;
  update public.supplier_produce_requests set status = p_status, responded_by = (select auth.uid()), responded_at = now() where id = q.id;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on all functions in schema private to service_role;
grant execute on function private.user_role(), private.is_staff(), private.supplier_role(), private.my_supplier(),
  private.can_see_supplier(uuid), private.is_signed_in() to authenticated;

revoke all on function
  public.supplier_products_save(uuid, jsonb), public.supplier_dispatch_create(uuid, date, text, jsonb),
  public.supplier_scan(uuid, jsonb), public.supplier_carton_void(uuid, text), public.supplier_dispatch_void_unused(uuid),
  public.supplier_carton_reprint(uuid), public.supplier_dispatch_set_photo(uuid, text), public.supplier_dispatch_close(uuid),
  public.supplier_dispatch_cancel(uuid), public.supplier_dispatch_receive(uuid), public.supplier_stock(uuid),
  public.supplier_threshold_set(uuid, integer), public.supplier_produce_respond(uuid, text)
  from public, anon;
grant execute on function
  public.supplier_products_save(uuid, jsonb), public.supplier_dispatch_create(uuid, date, text, jsonb),
  public.supplier_scan(uuid, jsonb), public.supplier_carton_void(uuid, text), public.supplier_dispatch_void_unused(uuid),
  public.supplier_carton_reprint(uuid), public.supplier_dispatch_set_photo(uuid, text), public.supplier_dispatch_close(uuid),
  public.supplier_dispatch_cancel(uuid), public.supplier_dispatch_receive(uuid), public.supplier_stock(uuid),
  public.supplier_threshold_set(uuid, integer), public.supplier_produce_respond(uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Photos: one private bucket. A file lives under "<supplier id>/<dispatch id>/<uuid>.jpg".
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('supplier-photos', 'supplier-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

create function private.can_see_supplier_path(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  folder text := split_part(p_name, '/', 1);
begin
  if folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.can_see_supplier(folder::uuid);
end $$;
revoke all on function private.can_see_supplier_path(text) from public, anon;
grant execute on function private.can_see_supplier_path(text) to authenticated, service_role;

create policy supplier_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'supplier-photos' and private.can_see_supplier_path(name));
create policy supplier_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'supplier-photos' and private.can_see_supplier_path(name));

-- ---------------------------------------------------------------------------
-- Schedule: 10 minutes after each stock sync (the sync runs on the hour and the half hour).
-- ---------------------------------------------------------------------------

select cron.schedule('supplier-produce-check', '10,40 * * * *', 'select private.supplier_produce_check()');

