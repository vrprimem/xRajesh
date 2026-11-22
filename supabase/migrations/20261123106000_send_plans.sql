-- Send plans: VRPRIME tells the supplier what to send next, by when, in full cartons. The supplier produces exactly
-- that, answers how far it is, and turns the plan into a dispatch when the goods are ready. Labels are printed only
-- then (by the dispatch), so the inventory software never holds labels for goods that do not exist yet.
--
--   supplier_send_plans       one plan: due date, note, status, and the dispatch it became
--   supplier_send_plan_lines  product, carton type, units per carton (as it was when planned), cartons
--
--   supplier_plan_create      VRPRIME owner and admin. The supplier's owners are told.
--   supplier_plan_respond     the supplier's owner: accepted, in production, ready. VRPRIME is told.
--   supplier_plan_cancel      VRPRIME, while the plan has not become a dispatch.
--   supplier_plan_to_dispatch the supplier's owner or VRPRIME: a dispatch with exactly the plan's lines.
--
-- Statuses: open (no answer yet) -> accepted -> in_production -> ready -> dispatched; or cancelled.

create table public.supplier_send_plans (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  number integer not null check (number >= 1),
  due_on date not null,
  note text check (note is null or length(note) <= 500),
  status text not null default 'open' check (status in ('open', 'accepted', 'in_production', 'ready', 'dispatched', 'cancelled')),
  dispatch_id uuid references public.supplier_dispatches (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  responded_by uuid references public.profiles (id) on delete set null,
  responded_at timestamptz,
  unique (supplier_id, number)
);
create index supplier_send_plans_open_idx on public.supplier_send_plans (supplier_id, status, due_on);
create index supplier_send_plans_dispatch_idx on public.supplier_send_plans (dispatch_id);
create index supplier_send_plans_created_by_idx on public.supplier_send_plans (created_by);
create index supplier_send_plans_responded_by_idx on public.supplier_send_plans (responded_by);

create table public.supplier_send_plan_lines (
  plan_id uuid not null references public.supplier_send_plans (id) on delete cascade,
  product_id uuid not null references public.supplier_products (id),
  carton_type text not null check (carton_type in ('H', 'T')),
  units_per_carton integer not null check (units_per_carton between 1 and 100000),
  cartons integer not null check (cartons between 1 and 5000),
  primary key (plan_id, product_id, carton_type)
);
create index supplier_send_plan_lines_product_idx on public.supplier_send_plan_lines (product_id);

alter table public.supplier_send_plans enable row level security;
alter table public.supplier_send_plan_lines enable row level security;
revoke all on public.supplier_send_plans, public.supplier_send_plan_lines from public, anon, authenticated;
grant select on public.supplier_send_plans, public.supplier_send_plan_lines to authenticated;
grant all on public.supplier_send_plans, public.supplier_send_plan_lines to service_role;
create policy supplier_send_plans_select on public.supplier_send_plans for select to authenticated
  using ((select private.can_see_supplier(supplier_id)));
create policy supplier_send_plan_lines_select on public.supplier_send_plan_lines for select to authenticated
  using (exists (select 1 from public.supplier_send_plans p where p.id = plan_id and (select private.can_see_supplier(p.supplier_id))));

-- Tells VRPRIME's owners and admins (used for the supplier's answers).
create function private.notify_staff(p_kind text, p_url text, p_title text, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  u uuid;
begin
  for u in select id from public.profiles where active and role in ('owner', 'admin') loop
    insert into public.notifications (user_id, kind, url, title, body) values (u, p_kind, p_url, left(p_title, 200), left(p_body, 1000));
  end loop;
end $$;

-- A plan from VRPRIME. Lines: [{product_id, cartons, carton_type?}]; carton type and units per carton default to the product's.
create function public.supplier_plan_create(p_supplier uuid, p_due date, p_note text, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_number integer;
  v_cartons integer;
  v_products integer;
  v_name text;
  u uuid;
begin
  perform private.require_staff();
  if not exists (select 1 from public.suppliers where id = p_supplier) then
    raise exception 'that supplier was not found' using errcode = '22023';
  end if;
  if p_due is null or p_due < (now() at time zone 'Asia/Kolkata')::date or p_due > current_date + 365 then
    raise exception 'pick a date from today on' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 500 then
    raise exception 'add at least one product with cartons' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) as x(product_id uuid, cartons integer)
             where x.product_id is null or x.cartons is null or x.cartons < 1 or x.cartons > 5000) then
    raise exception 'every line needs a product and a whole number of cartons from 1' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) as x(product_id uuid)
             where not exists (select 1 from public.supplier_products p where p.id = x.product_id and p.supplier_id = p_supplier and p.active)) then
    raise exception 'a product in the plan is not one of this supplier''s active products' using errcode = '22023';
  end if;
  select string_agg(distinct p.name, ', ') into v_name
  from jsonb_to_recordset(p_lines) as x(product_id uuid) join public.supplier_products p on p.id = x.product_id where p.master_id is null;
  if v_name is not null then
    raise exception 'set the VRPRIME master SKU first for: %', left(v_name, 300) using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) as x(carton_type text) where coalesce(nullif(btrim(x.carton_type), ''), 'H') not in ('H', 'T')) then
    raise exception 'a carton type is not understood' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('supplier_plan:' || p_supplier::text));
  select coalesce(max(number), 0) + 1 into v_number from public.supplier_send_plans where supplier_id = p_supplier;
  insert into public.supplier_send_plans (supplier_id, number, due_on, note, created_by)
  values (p_supplier, v_number, p_due, nullif(left(btrim(coalesce(p_note, '')), 500), ''), (select auth.uid()))
  returning id into v_id;

  insert into public.supplier_send_plan_lines (plan_id, product_id, carton_type, units_per_carton, cartons)
  select v_id, p.id, coalesce(nullif(btrim(x.carton_type), ''), p.carton_type), p.units_per_carton, sum(x.cartons)::integer
  from jsonb_to_recordset(p_lines) as x(product_id uuid, carton_type text, cartons integer)
  join public.supplier_products p on p.id = x.product_id
  group by p.id, coalesce(nullif(btrim(x.carton_type), ''), p.carton_type), p.units_per_carton;

  select sum(cartons), count(distinct product_id) into v_cartons, v_products from public.supplier_send_plan_lines where plan_id = v_id;
  select name into v_name from public.suppliers where id = p_supplier;
  for u in select id from public.profiles where active and role = 'supplier_owner' and supplier_id = p_supplier loop
    insert into public.notifications (user_id, kind, url, title, body)
    values (u, 'supplier_plan', '/supplier',
            'VRPRIME send plan ' || v_number || ': ' || v_cartons || ' cartons by ' || to_char(p_due, 'FMDD Mon'),
            v_products || case when v_products = 1 then ' product' else ' products' end || '. Open the app to see what to make and accept it.');
  end loop;
  return v_id;
end $$;

-- The supplier's answer.
create function public.supplier_plan_respond(p_plan uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  pl public.supplier_send_plans%rowtype;
  v_name text;
  v_label text;
begin
  select * into pl from public.supplier_send_plans where id = p_plan for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform private.require_supplier_editor(pl.supplier_id);
  if p_status not in ('accepted', 'in_production', 'ready') then
    raise exception 'that answer is not understood' using errcode = '22023';
  end if;
  if pl.status in ('dispatched', 'cancelled') then
    raise exception 'this plan is already %', pl.status using errcode = '22023';
  end if;
  if pl.status = p_status then
    return;
  end if;
  update public.supplier_send_plans set status = p_status, responded_by = (select auth.uid()), responded_at = now() where id = pl.id;
  select name into v_name from public.suppliers where id = pl.supplier_id;
  v_label := case p_status when 'accepted' then 'accepted' when 'in_production' then 'is making' else 'has ready' end;
  perform private.notify_staff('supplier_plan_answer', '/suppliers/' || pl.supplier_id::text,
    v_name || ' ' || v_label || ' send plan ' || pl.number,
    'Due ' || to_char(pl.due_on, 'FMDD Mon') || '.');
end $$;

create function public.supplier_plan_cancel(p_plan uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  pl public.supplier_send_plans%rowtype;
  u uuid;
begin
  perform private.require_staff();
  select * into pl from public.supplier_send_plans where id = p_plan for update;
  if not found then
    raise exception 'that plan was not found' using errcode = '22023';
  end if;
  if pl.status in ('dispatched', 'cancelled') then
    raise exception 'this plan is already %', pl.status using errcode = '22023';
  end if;
  update public.supplier_send_plans set status = 'cancelled' where id = pl.id;
  for u in select id from public.profiles where active and role = 'supplier_owner' and supplier_id = pl.supplier_id loop
    insert into public.notifications (user_id, kind, url, title, body)
    values (u, 'supplier_plan', '/supplier', 'VRPRIME cancelled send plan ' || pl.number, 'Do not make it any more.');
  end loop;
end $$;

-- Turns a plan into a dispatch with exactly its lines and due date. Its labels are then printed as for any dispatch.
create function public.supplier_plan_to_dispatch(p_plan uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  pl public.supplier_send_plans%rowtype;
  v_lines jsonb;
  v_dispatch uuid;
  v_name text;
begin
  select * into pl from public.supplier_send_plans where id = p_plan for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform private.require_supplier_editor(pl.supplier_id);
  if pl.status in ('dispatched', 'cancelled') then
    raise exception 'this plan is already %', pl.status using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'carton_type', carton_type, 'units_per_carton', units_per_carton, 'cartons', cartons))
  into v_lines from public.supplier_send_plan_lines where plan_id = pl.id;
  v_dispatch := public.supplier_dispatch_create(pl.supplier_id, greatest(pl.due_on, (now() at time zone 'Asia/Kolkata')::date),
                                                'From VRPRIME send plan ' || pl.number || coalesce(': ' || pl.note, ''), v_lines);
  update public.supplier_send_plans set status = 'dispatched', dispatch_id = v_dispatch, responded_by = (select auth.uid()), responded_at = now() where id = pl.id;
  select name into v_name from public.suppliers where id = pl.supplier_id;
  if private.supplier_role() is not null then
    perform private.notify_staff('supplier_plan_answer', '/suppliers/' || pl.supplier_id::text,
      v_name || ' made a dispatch from send plan ' || pl.number, 'Labels are being printed; loading can start.');
  end if;
  return v_dispatch;
end $$;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on all functions in schema private to service_role;
grant execute on function private.user_role(), private.is_staff(), private.supplier_role(), private.my_supplier(),
  private.can_see_supplier(uuid), private.is_signed_in(), private.can_see_supplier_path(text) to authenticated;

revoke all on function public.supplier_plan_create(uuid, date, text, jsonb), public.supplier_plan_respond(uuid, text),
  public.supplier_plan_cancel(uuid), public.supplier_plan_to_dispatch(uuid) from public, anon;
grant execute on function public.supplier_plan_create(uuid, date, text, jsonb), public.supplier_plan_respond(uuid, text),
  public.supplier_plan_cancel(uuid), public.supplier_plan_to_dispatch(uuid) to authenticated, service_role;
