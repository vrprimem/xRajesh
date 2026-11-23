-- Factory reset: the owner wipes the portal's data, after confirming with a one-time code sent to their email.
--
-- Two levels, chosen on the reset page:
--   'activity'    dispatches (with their lines, cartons and scans), send plans, produce requests and alerts.
--                 Suppliers, their logins, products, minimums and the stock copy stay: for clearing a test run.
--   'everything'  all of the above, plus suppliers, their logins, products, minimums and the copy of VRPRIME's stock
--                 (the stock copy refills from the inventory software straight away).
-- VRPRIME's own logins (owner and admin) are always kept. Nothing in the inventory software is touched: labels made
-- there stay there. Vehicle photos are files, which only the Storage API can remove, so this function returns their
-- paths and the app removes them.
--
-- The lock, all checked here in the database:
--   * the caller is an active owner;
--   * their session was made by entering an emailed one-time code in the last 10 minutes (an 'otp' entry in the
--     session's amr claim; the portal's normal sign-in is by password, so only the reset page makes one);
--   * they asked for that code from the reset page in the last 15 minutes, and each request allows one reset.
-- Every reset is written to private.factory_resets, which no reset ever clears.

create table private.factory_reset_requests (
  user_id uuid primary key references auth.users (id) on delete cascade,
  requested_at timestamptz not null default now()
);
alter table private.factory_reset_requests enable row level security;
revoke all on private.factory_reset_requests from public, anon, authenticated;

create table private.factory_resets (
  id bigint generated always as identity primary key,
  user_id uuid,
  user_name text,
  scope text not null check (scope in ('activity', 'everything')),
  counts jsonb not null,
  created_at timestamptz not null default now()
);
alter table private.factory_resets enable row level security;
revoke all on private.factory_resets from public, anon, authenticated;

-- Step 1, just before the app asks Supabase to email the code: note that the owner asked for a reset code.
create function public.factory_reset_request() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if private.user_role() is distinct from 'owner' then
    raise exception 'Only the owner can reset the portal' using errcode = '42501';
  end if;
  insert into private.factory_reset_requests (user_id) values ((select auth.uid()))
  on conflict (user_id) do update set requested_at = now();
end $$;

-- Step 2, after the code was entered: wipe. Returns how much went, and the photo files the app must remove.
create function public.factory_reset(p_scope text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_counts jsonb := '{}'::jsonb;
  v_photos text[];
  v_n bigint;
begin
  if p_scope is null or p_scope not in ('activity', 'everything') then
    raise exception 'Choose what to wipe' using errcode = '22023';
  end if;
  if private.user_role() is distinct from 'owner' then
    raise exception 'Only the owner can reset the portal' using errcode = '42501';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb)) e
    where e ->> 'method' in ('otp', 'magiclink')
      and to_timestamp((e ->> 'timestamp')::double precision) > now() - interval '10 minutes'
  ) then
    raise exception 'Confirm with the code from your email first' using errcode = '42501';
  end if;
  delete from private.factory_reset_requests where user_id = v_uid and requested_at > now() - interval '15 minutes';
  if not found then
    raise exception 'Ask for a new code first' using errcode = '42501';
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

  return jsonb_build_object('counts', v_counts, 'photos', to_jsonb(v_photos));
end $$;

revoke all on function public.factory_reset_request(), public.factory_reset(text) from public, anon;
grant execute on function public.factory_reset_request(), public.factory_reset(text) to authenticated;
