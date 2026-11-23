-- Factory reset fix: Supabase runs every request that comes through its API with the safeupdate guard, which refuses
-- an UPDATE or DELETE without a WHERE clause, even inside a function. The reset's full-table deletes were refused
-- ("DELETE requires a WHERE clause") and the whole reset was undone, so nothing was deleted. Each one now says
-- "where true": a deliberate full wipe. Everything else is as in 20261123108000_factory_reset_authenticator.sql.
-- src/lib/migrations.test.ts checks every database function for this from now on.

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
  delete from public.notifications where true;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('alerts', v_n);

  if p_scope = 'everything' then
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
