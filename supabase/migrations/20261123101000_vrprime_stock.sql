-- VRPRIME stock, read from the inventory software (inventory.vrprime.in, the in-house barcode scanner software) every
-- 30 minutes and on "Sync now". Read only: nothing here ever changes anything in the inventory software.
--
--   master_products        the inventory software's products (its code and name): the "master SKU" a supplier's product links to
--   inventory_stock        pieces on hand per product and warehouse, as of the last good sync
--   inventory_sync_state   one row: when the last sync was tried, when it last worked, and the last error
--   inventory_sync_save    the Edge Function's save (service role only)
--   request_inventory_sync the "Sync now" button (VRPRIME owner and admin)
--
-- Only VRPRIME's own people read these tables. A supplier login reaches stock through supplier_stock() alone (next
-- migration): its own products, at its one warehouse.
--
-- The inventory software's login (VRPRIME_API_USERNAME and VRPRIME_API_PASSWORD) lives only in the Edge Function's secrets.

create table public.master_products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (length(btrim(code)) between 1 and 100),
  name text not null check (length(btrim(name)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index master_products_code_lower_idx on public.master_products (lower(code));

create table public.inventory_stock (
  code text not null references public.master_products (code) on update cascade on delete cascade,
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  pieces integer not null check (pieces >= 0),
  synced_at timestamptz not null default now(),
  primary key (code, warehouse_id)
);
create index inventory_stock_warehouse_idx on public.inventory_stock (warehouse_id);

create table public.inventory_sync_state (
  id boolean primary key default true check (id),
  last_try_at timestamptz,
  last_ok_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 500),
  last_products integer,
  last_pieces bigint
);
insert into public.inventory_sync_state (id) values (true);

alter table public.master_products enable row level security;
alter table public.inventory_stock enable row level security;
alter table public.inventory_sync_state enable row level security;
revoke all on public.master_products, public.inventory_stock, public.inventory_sync_state from public, anon, authenticated;
grant select on public.master_products, public.inventory_stock, public.inventory_sync_state to authenticated;
grant all on public.master_products, public.inventory_stock, public.inventory_sync_state to service_role;

create policy master_products_select on public.master_products for select to authenticated using ((select private.is_staff()));
create policy inventory_stock_select on public.inventory_stock for select to authenticated using ((select private.is_staff()));
create policy inventory_sync_state_select on public.inventory_sync_state for select to authenticated using ((select private.is_staff()));

-- The save. p_warehouses: [{vid, name}] (the inventory software's warehouses). p_rows: [{code, name, vid, pieces}],
-- one per product and warehouse. Everything is checked first; an answer with far fewer products than the last one is
-- refused, so a half-empty reply can never wipe the stock. Products and warehouses are added and renamed, never removed;
-- a product missing from the answer is set to 0.
create function public.inventory_sync_save(p_warehouses jsonb, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_products integer;
  v_pieces bigint;
  v_before integer;
begin
  if jsonb_typeof(p_warehouses) is distinct from 'array' or jsonb_array_length(p_warehouses) = 0 or jsonb_array_length(p_warehouses) > 200 then
    raise exception 'the inventory software listed no warehouses' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'the inventory software listed no products' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 200000 then
    raise exception 'the inventory software listed too many lines' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_warehouses) as w(vid text, name text)
             where coalesce(btrim(w.vid), '') = '' or coalesce(btrim(w.name), '') = '' or length(w.name) > 120) then
    raise exception 'a warehouse has no id or name' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_warehouses) as w(vid text, name text) group by lower(btrim(w.name)) having count(*) > 1)
     or exists (select 1 from jsonb_to_recordset(p_warehouses) as w(vid text) group by btrim(w.vid) having count(*) > 1) then
    raise exception 'a warehouse is listed twice' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as x(code text, name text, vid text, pieces integer)
             where coalesce(btrim(x.code), '') = '' or length(x.code) > 100
                or coalesce(btrim(x.name), '') = '' or length(x.name) > 200
                or x.vid is null or x.pieces is null or x.pieces < 0) then
    raise exception 'every line needs a product code, a name, a warehouse and pieces of 0 or more' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as x(vid text)
             where not exists (select 1 from jsonb_to_recordset(p_warehouses) as w(vid text) where btrim(w.vid) = btrim(x.vid))) then
    raise exception 'a line names a warehouse that was not listed' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as x(code text, vid text) group by lower(btrim(x.code)), btrim(x.vid) having count(*) > 1) then
    raise exception 'a product is listed twice for one warehouse' using errcode = '22023';
  end if;

  select count(distinct lower(btrim(x.code))), coalesce(sum(x.pieces), 0) into v_products, v_pieces
  from jsonb_to_recordset(p_rows) as x(code text, pieces integer);
  select last_products into v_before from public.inventory_sync_state where id;
  if v_before is not null and v_before >= 10 and v_products * 2 < v_before then
    raise exception 'the inventory software listed % products, far fewer than the % before; not saved', v_products, v_before using errcode = '22023';
  end if;

  -- Warehouses: matched by the inventory software's id first, then by name (case ignored).
  update public.warehouses t set name = btrim(w.name)
  from jsonb_to_recordset(p_warehouses) as w(vid text, name text)
  where t.vrprime_id = btrim(w.vid) and t.name <> btrim(w.name)
    and not exists (select 1 from public.warehouses o where lower(o.name) = lower(btrim(w.name)) and o.id <> t.id);
  update public.warehouses t set vrprime_id = btrim(w.vid)
  from jsonb_to_recordset(p_warehouses) as w(vid text, name text)
  where t.vrprime_id is null and lower(t.name) = lower(btrim(w.name));
  insert into public.warehouses (name, vrprime_id)
  select btrim(w.name), btrim(w.vid) from jsonb_to_recordset(p_warehouses) as w(vid text, name text)
  where not exists (select 1 from public.warehouses t where t.vrprime_id = btrim(w.vid))
  on conflict do nothing;

  -- Products, by code (case ignored). The newest name wins.
  update public.master_products m set name = n.name, updated_at = v_now
  from (select distinct on (lower(btrim(x.code))) btrim(x.code) as code, btrim(x.name) as name
        from jsonb_to_recordset(p_rows) as x(code text, name text) order by lower(btrim(x.code))) n
  where lower(m.code) = lower(n.code) and m.name <> n.name;
  insert into public.master_products (code, name)
  select distinct on (lower(btrim(x.code))) btrim(x.code), btrim(x.name)
  from jsonb_to_recordset(p_rows) as x(code text, name text)
  where not exists (select 1 from public.master_products m where lower(m.code) = lower(btrim(x.code)))
  order by lower(btrim(x.code));

  -- Stock.
  insert into public.inventory_stock (code, warehouse_id, pieces, synced_at)
  select m.code, t.id, x.pieces, v_now
  from jsonb_to_recordset(p_rows) as x(code text, vid text, pieces integer)
  join public.master_products m on lower(m.code) = lower(btrim(x.code))
  join public.warehouses t on t.vrprime_id = btrim(x.vid)
  on conflict (code, warehouse_id) do update set pieces = excluded.pieces, synced_at = excluded.synced_at;
  update public.inventory_stock set pieces = 0, synced_at = v_now where synced_at < v_now;

  update public.inventory_sync_state
  set last_try_at = v_now, last_ok_at = v_now, last_error = null, last_products = v_products, last_pieces = v_pieces
  where id;
  return jsonb_build_object('products', v_products, 'pieces', v_pieces);
end $$;
revoke all on function public.inventory_sync_save(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.inventory_sync_save(jsonb, jsonb) to service_role;

-- A failed sync is remembered, so the page can say so. The stock keeps its last good numbers.
create function public.inventory_sync_fail(p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.inventory_sync_state set last_try_at = now(), last_error = left(coalesce(nullif(btrim(p_error), ''), 'unknown error'), 500) where id;
$$;
revoke all on function public.inventory_sync_fail(text) from public, anon, authenticated;
grant execute on function public.inventory_sync_fail(text) to service_role;

create function private.start_inventory_sync() returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.inventory_sync_state set last_try_at = now() where id;
  perform private.call_function('inventory-sync', jsonb_build_object('job', 'sync'));
end $$;
revoke all on function private.start_inventory_sync() from public, anon, authenticated;

-- The "Sync now" button: VRPRIME owner and admin. Pressed twice in 20 seconds, the second press does nothing.
create function public.request_inventory_sync() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_staff();
  if exists (select 1 from public.inventory_sync_state where id and last_try_at > now() - interval '20 seconds') then
    return;
  end if;
  perform private.start_inventory_sync();
end $$;
revoke all on function public.request_inventory_sync() from public, anon;
grant execute on function public.request_inventory_sync() to authenticated;

select cron.schedule('inventory-sync', '*/30 * * * *', 'select private.start_inventory_sync()');
