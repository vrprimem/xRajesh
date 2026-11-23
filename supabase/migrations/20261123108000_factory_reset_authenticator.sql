-- Factory reset, confirmed with an authenticator app instead of an emailed code (Supabase only emails a code through a
-- custom email sender, which this project does not have). What a reset deletes and keeps is unchanged; see
-- 20261123107000_factory_reset.sql.
--
-- The owner links an authenticator app (Google Authenticator, Microsoft Authenticator and the like) once, from the
-- reset page: they enter their password again, the database makes a random secret and hands it out once as a QR code,
-- and the app's first code proves it was set up. After that every reset needs the app's current 6-digit code, which
-- the database checks itself (standard TOTP, RFC 6238: HMAC-SHA1, 30-second steps, one step of clock drift either way):
--   * each code works once;
--   * 5 wrong codes in a row lock codes out for 15 minutes;
--   * a linked app cannot be replaced from the portal, or anyone who learnt the owner's password could link their own
--     phone. To replace a lost phone, remove the link in the Supabase SQL editor (see SETUP.md):
--       delete from private.reset_authenticators;
-- Supabase's own sign-in MFA is not used, so signing in works exactly as before.

drop function if exists public.factory_reset(text);
drop function if exists public.factory_reset_request();
drop table if exists private.factory_reset_requests;

create table private.reset_authenticators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- 20 random bytes; handed out once, as the QR code, while linking.
  secret bytea not null check (length(secret) = 20),
  -- Set when the app's first code was right. Until then the link is only being set up.
  confirmed_at timestamptz,
  -- The last 30-second step a code was used for: no code works twice.
  last_step bigint not null default 0,
  failed integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
alter table private.reset_authenticators enable row level security;
revoke all on private.reset_authenticators from public, anon, authenticated;

-- The 6-digit code of a secret at a 30-second step: RFC 4226 dynamic truncation of HMAC-SHA1.
create function private.totp_code(p_secret bytea, p_step bigint) returns text
language plpgsql immutable set search_path = '' as $$
declare
  h bytea := extensions.hmac(int8send(p_step), p_secret, 'sha1');
  o integer := get_byte(h, 19) & 15;
  v bigint;
begin
  v := ((get_byte(h, o) & 127)::bigint << 24)
     | (get_byte(h, o + 1)::bigint << 16)
     | (get_byte(h, o + 2)::bigint << 8)
     | get_byte(h, o + 3)::bigint;
  return lpad((v % 1000000)::text, 6, '0');
end $$;

-- Checks a code against a login's app: 'ok', 'wrong', 'locked' or 'missing'. A right code is used up; wrong ones are
-- counted, and the 5th in a row locks codes out for 15 minutes. It never raises, so the count is kept.
create function private.totp_verify(p_user uuid, p_code text, p_linked boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  a private.reset_authenticators;
  now_step bigint := floor(extract(epoch from now()) / 30)::bigint;
  s bigint;
begin
  select * into a from private.reset_authenticators where user_id = p_user for update;
  if not found or (a.confirmed_at is not null) <> p_linked then
    return 'missing';
  end if;
  if a.locked_until is not null and a.locked_until > now() then
    return 'locked';
  end if;
  if coalesce(p_code, '') ~ '^[0-9]{6}$' then
    for s in select g from generate_series(now_step - 1, now_step + 1) g loop
      if s > a.last_step and private.totp_code(a.secret, s) = p_code then
        update private.reset_authenticators set last_step = s, failed = 0, locked_until = null where user_id = p_user;
        return 'ok';
      end if;
    end loop;
  end if;
  update private.reset_authenticators
     set failed = case when failed + 1 >= 5 then 0 else failed + 1 end,
         locked_until = case when failed + 1 >= 5 then now() + interval '15 minutes' else locked_until end
   where user_id = p_user;
  return 'wrong';
end $$;

revoke all on function private.totp_code(bytea, bigint), private.totp_verify(uuid, text, boolean) from public, anon, authenticated;

create function private.require_owner() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.user_role() is distinct from 'owner' then
    raise exception 'Only the owner can reset the portal' using errcode = '42501';
  end if;
end $$;
revoke all on function private.require_owner() from public, anon, authenticated;

-- 'none', 'pending' (QR code shown, first code not yet entered) or 'linked'.
create function public.reset_authenticator_status() returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_owner();
  return coalesce(
    (select case when confirmed_at is null then 'pending' else 'linked' end from private.reset_authenticators where user_id = (select auth.uid())),
    'none');
end $$;

-- Starts linking an app: a new random secret, returned once (as hex) for the QR code. Needs a password sign-in in the
-- last 10 minutes, and is refused once an app is linked.
create function public.reset_authenticator_begin() returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_secret bytea := extensions.gen_random_bytes(20);
begin
  perform private.require_owner();
  if not exists (
    select 1 from jsonb_array_elements(coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb)) e
    where e ->> 'method' = 'password'
      and to_timestamp((e ->> 'timestamp')::double precision) > now() - interval '10 minutes'
  ) then
    raise exception 'Enter your password first' using errcode = '42501';
  end if;
  if exists (select 1 from private.reset_authenticators where user_id = (select auth.uid()) and confirmed_at is not null) then
    raise exception 'An authenticator app is already linked' using errcode = '42501';
  end if;
  insert into private.reset_authenticators (user_id, secret) values ((select auth.uid()), v_secret)
  on conflict (user_id) do update
    set secret = excluded.secret, confirmed_at = null, last_step = 0, failed = 0, locked_until = null, created_at = now();
  return encode(v_secret, 'hex');
end $$;

-- Finishes linking: the app's current code proves it was set up right. Returns what totp_verify said.
create function public.reset_authenticator_confirm(p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v text;
begin
  perform private.require_owner();
  v := private.totp_verify((select auth.uid()), btrim(p_code), false);
  if v = 'ok' then
    update private.reset_authenticators set confirmed_at = now() where user_id = (select auth.uid());
  end if;
  return v;
end $$;

-- The reset: the owner, with the linked app's current code. A wrong code returns {ok: false, reason} (so the count of
-- wrong codes is kept); a right one wipes and returns how much went and the photo files the app must remove.
create function public.factory_reset(p_scope text, p_code text) returns jsonb
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
  delete from public.supplier_send_plan_lines;
  delete from public.supplier_send_plans;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('send_plans', v_n);
  delete from public.supplier_scan_events;
  delete from public.supplier_cartons;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('cartons', v_n);
  delete from public.supplier_dispatch_lines;
  delete from public.supplier_dispatches;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('dispatches', v_n);
  delete from public.supplier_produce_requests;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('produce_requests', v_n);
  delete from public.notifications;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('alerts', v_n);

  if p_scope = 'everything' then
    delete from public.supplier_thresholds;
    delete from public.supplier_products;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('products', v_n);
    -- Removing a supplier login removes its profile, alerts and devices with it. VRPRIME's own logins stay.
    delete from auth.users u using public.profiles p where p.id = u.id and p.role in ('supplier_owner', 'supplier_scanner');
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('supplier_logins', v_n);
    delete from public.suppliers;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('suppliers', v_n);
    -- The copy of VRPRIME's stock, warehouses and master SKUs: read again from the inventory software right away.
    delete from public.inventory_stock;
    delete from public.master_products;
    delete from public.warehouses;
    update public.inventory_sync_state set last_ok_at = null, last_error = null, last_products = null, last_pieces = null where id;
    perform private.start_inventory_sync();
  end if;

  v_counts := v_counts || jsonb_build_object('photos', coalesce(array_length(v_photos, 1), 0));
  insert into private.factory_resets (user_id, user_name, scope, counts)
  values (v_uid, (select name from public.profiles where id = v_uid), p_scope, v_counts);

  return jsonb_build_object('ok', true, 'counts', v_counts, 'photos', to_jsonb(v_photos));
end $$;

revoke all on function public.reset_authenticator_status(), public.reset_authenticator_begin(), public.reset_authenticator_confirm(text),
  public.factory_reset(text, text) from public, anon;
grant execute on function public.reset_authenticator_status(), public.reset_authenticator_begin(), public.reset_authenticator_confirm(text),
  public.factory_reset(text, text) to authenticated;
