-- VRPRIME Supplier Portal: people, suppliers, notifications and the access rules everything else stands on.
--
-- Two kinds of people sign in:
--   owner, admin                       VRPRIME's own. They see every supplier. The owner also manages logins.
--   supplier_owner, supplier_scanner   a supplier's logins (outsiders). They see their own supplier and nothing else.
--
-- The lock is here in the database (Row Level Security and the checks inside every function); the app only hides things.
--   private.user_role()      the VRPRIME role of the signed-in person; NULL for a supplier login or anyone signed out
--   private.supplier_role()  the supplier role; NULL for VRPRIME's own people
--   private.can_see_supplier(id)  VRPRIME owner and admin: any supplier. A supplier login: its own.
--
-- supabase/tests/supplier_check.sql proves the rules.

create extension if not exists pg_net;
create extension if not exists pg_cron with schema pg_catalog;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- VRPRIME's warehouses, as the inventory software lists them. Filled by the stock sync.
create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 120),
  -- The warehouse's id in the inventory software.
  vrprime_id text unique,
  created_at timestamptz not null default now()
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 120),
  -- Where its goods are received (Bhiwandi for Rajesh). The supplier sees this warehouse's stock of its own products only.
  warehouse_id uuid not null references public.warehouses (id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index suppliers_warehouse_idx on public.suppliers (warehouse_id);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  role text not null check (role in ('owner', 'admin', 'supplier_owner', 'supplier_scanner')),
  supplier_id uuid references public.suppliers (id),
  phone text,
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  -- A supplier login always has a supplier; VRPRIME's own people never do.
  constraint profiles_supplier_check check ((role in ('supplier_owner', 'supplier_scanner')) = (supplier_id is not null))
);
create index profiles_supplier_idx on public.profiles (supplier_id) where supplier_id is not null;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (length(kind) between 1 and 40),
  title text not null check (length(title) between 1 and 200),
  body text check (body is null or length(body) <= 1000),
  -- The page of this site the notification opens (a path such as /supplier).
  url text check (url is null or url ~ '^/[A-Za-z0-9/_-]*$'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- The helpers every rule uses
-- ---------------------------------------------------------------------------

create function private.user_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid()) and active and role in ('owner', 'admin')
$$;

create function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.user_role() in ('owner', 'admin'), false)
$$;

-- 'supplier_owner' or 'supplier_scanner' for an active login of an active supplier, else NULL.
create function private.supplier_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  join public.suppliers s on s.id = p.supplier_id and s.active
  where p.id = (select auth.uid()) and p.active and p.role in ('supplier_owner', 'supplier_scanner')
$$;

-- The supplier of the signed-in supplier login, else NULL.
create function private.my_supplier() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.supplier_id from public.profiles p
  join public.suppliers s on s.id = p.supplier_id and s.active
  where p.id = (select auth.uid()) and p.active and p.role in ('supplier_owner', 'supplier_scanner')
$$;

create function private.can_see_supplier(p_supplier uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_staff(), false) or coalesce(p_supplier = private.my_supplier(), false)
$$;

-- Anyone signed in and active, on either side.
create function private.is_signed_in() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.user_role() is not null or private.supplier_role() is not null
$$;

create function private.require_staff() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not coalesce(private.is_staff(), false) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- The first login ever created (in the Supabase dashboard) becomes the owner. After that this does nothing: every
-- other login is created in the app by the owner.
create function private.bootstrap_first_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles) then
    insert into public.profiles (id, name, role, must_change_password)
    values (new.id, coalesce(nullif(split_part(new.email, '@', 1), ''), 'Owner'), 'owner', false);
  end if;
  return new;
end $$;

create trigger bootstrap_first_owner after insert on auth.users
  for each row execute function private.bootstrap_first_owner();

-- The last active owner can never be demoted, deactivated or deleted.
create function private.protect_last_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('profiles_owners'));
  if old.role = 'owner' and old.active
     and (tg_op = 'DELETE' or new.role <> 'owner' or not new.active)
     and not exists (select 1 from public.profiles p where p.role = 'owner' and p.active and p.id <> old.id) then
    raise exception 'There must always be at least one active owner' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger protect_last_owner before update or delete on public.profiles
  for each row execute function private.protect_last_owner();

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;

alter table public.warehouses enable row level security;
alter table public.suppliers enable row level security;
alter table public.profiles enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;

-- Warehouses: VRPRIME's own people only.
grant select on public.warehouses to authenticated;
create policy warehouses_select on public.warehouses for select to authenticated
  using ((select private.is_staff()));

-- Suppliers: VRPRIME reads all, a supplier login reads its own row. Changes go through the app with the service key,
-- after it has checked the owner.
grant select on public.suppliers to authenticated;
create policy suppliers_select on public.suppliers for select to authenticated
  using ((select private.can_see_supplier(id)));

-- Profiles: VRPRIME reads all; everyone reads their own row. Nobody changes one through the API.
grant select on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using ((select private.is_staff()) or id = (select auth.uid()));

-- Notifications: your own. You may mark them read; nothing else about them can be changed.
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_signed_in()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_signed_in()))
  with check (user_id = (select auth.uid()));

-- Push subscriptions: your own devices. Added through register_push_subscription below.
grant select, delete on public.push_subscriptions to authenticated;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_signed_in()));
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Calling the Edge Functions from the database (push, stock sync)
-- ---------------------------------------------------------------------------

-- Never exposed through the API: schema `private`, RLS on, no policies.
create table private.internal_config (
  key text primary key,
  value text not null
);
alter table private.internal_config enable row level security;
revoke all on private.internal_config from public, anon, authenticated;

-- functions_url is set once after the project is created (see SETUP.md):
--   update private.internal_config set value = 'https://<project-ref>.supabase.co/functions/v1' where key = 'functions_url';
-- The secret is made here and never leaves the database: each function asks the database whether the secret it was
-- sent is right, so nobody else can call them.
insert into private.internal_config (key, value) values
  ('functions_url', ''),
  ('internal_secret', encode(extensions.gen_random_bytes(32), 'hex'));

-- Sends one request to an Edge Function. Never raises: a failed push must not undo what caused it.
create function private.call_function(p_name text, p_body jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from private.internal_config where key = 'functions_url';
  select value into v_secret from private.internal_config where key = 'internal_secret';
  if coalesce(v_url, '') = '' or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/' || p_name,
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
    timeout_milliseconds := 10000);
exception when others then
  raise warning 'call_function % failed: %', p_name, sqlerrm;
end $$;

-- An Edge Function uses this to check the secret it was sent. Service role only.
create function public.check_internal_secret(candidate text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.internal_config
    where key = 'internal_secret' and value = candidate and candidate <> '')
$$;
revoke all on function public.check_internal_secret(text) from public, anon, authenticated;
grant execute on function public.check_internal_secret(text) to service_role;

-- ---------------------------------------------------------------------------
-- Notifications: every new one is also pushed to the person's phones
-- ---------------------------------------------------------------------------

create function private.notifications_push() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.call_function('notify', jsonb_build_object('job', 'push', 'notification_id', new.id));
  return new;
end $$;

create trigger notifications_push after insert on public.notifications
  for each row execute function private.notifications_push();

-- Saves this device for push. A phone that changes hands moves to whoever signed in last.
create function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.is_signed_in() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 1000
     or coalesce(length(p_p256dh), 0) not between 20 and 200 or coalesce(length(p_auth), 0) not between 8 and 100 then
    raise exception 'that device could not be registered' using errcode = '22023';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values ((select auth.uid()), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

-- The "Send me a test" button.
create function public.send_test_notification() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.is_signed_in() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.notifications (user_id, kind, title, body)
  values ((select auth.uid()), 'test', 'Test notification', 'If you can read this, notifications work on this device.');
end $$;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on all functions in schema private to service_role;
grant execute on function private.user_role(), private.is_staff(), private.supplier_role(), private.my_supplier(),
  private.can_see_supplier(uuid), private.is_signed_in() to authenticated;

revoke all on function public.register_push_subscription(text, text, text), public.send_test_notification() from public, anon;
grant execute on function public.register_push_subscription(text, text, text), public.send_test_notification() to authenticated;
