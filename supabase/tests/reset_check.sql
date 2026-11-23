-- Factory reset check: only an owner who has just entered an emailed code, asked for from the reset page, can reset;
-- 'activity' clears a test run but keeps suppliers, their logins, products, minimums and the stock copy; 'everything'
-- clears those too but keeps VRPRIME's own logins; each code allows one reset; every reset is logged.
--
-- It runs real resets inside one transaction that is rolled back, so it leaves nothing behind. Even so it refuses to
-- run on a database that has suppliers in it: run it on a fresh copy or the local stand-in, never on the live portal.
-- Any failed check raises an error.

begin;

do $$
declare
  u_own uuid := gen_random_uuid();   -- VRPRIME owner
  u_adm uuid := gen_random_uuid();   -- VRPRIME admin
  u_raj uuid := gen_random_uuid();   -- supplier owner
  w uuid;
  s uuid;
  p uuid;
  d uuid;
  pl uuid;
  r jsonb;
  blocked boolean;
  logged int;
  t bigint := extract(epoch from now())::bigint;
begin
  if exists (select 1 from public.suppliers) then
    raise exception 'This check runs real resets (rolled back); run it on an empty copy, not the live portal';
  end if;
  logged := (select count(*) from private.factory_resets);

  -- A small but complete portal: one supplier with a login, a product with a minimum, a dispatch with cartons and a
  -- scan, a send plan, a produce request, alerts, a vehicle photo and a copy of VRPRIME's stock.
  insert into auth.users (id, instance_id, aud, role, email) values
    (u_own, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc-own@example.test'),
    (u_adm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc-adm@example.test'),
    (u_raj, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rc-raj@example.test');
  insert into public.profiles (id, name, role, must_change_password) values
    (u_own, 'RC Owner', 'owner', false), (u_adm, 'RC Admin', 'admin', false)
  on conflict (id) do update set name = excluded.name, role = excluded.role, must_change_password = false;
  insert into public.warehouses (name, vrprime_id) values ('RC Main', 'rc-1') returning id into w;
  insert into public.suppliers (name, warehouse_id) values ('RC Supplier', w) returning id into s;
  insert into public.profiles (id, name, role, supplier_id, must_change_password) values (u_raj, 'RC Raj', 'supplier_owner', s, false);
  insert into public.master_products (code, name) values ('RC-1', 'RC master');
  insert into public.inventory_stock (code, warehouse_id, pieces) values ('RC-1', w, 10);
  insert into public.supplier_products (supplier_id, name, units_per_carton) values (s, 'RC Spray', 24) returning id into p;
  insert into public.supplier_thresholds (product_id, supplier_id, min_units) values (p, s, 100);
  insert into public.supplier_dispatches (supplier_id, number, due_on, created_by) values (s, 1, current_date, u_raj) returning id into d;
  insert into public.supplier_dispatch_lines (dispatch_id, product_id, carton_type, units_per_carton, cartons) values (d, p, 'H', 24, 2);
  insert into public.supplier_cartons (supplier_id, dispatch_id, product_id, carton_type, units, carton_no, barcode) values
    (s, d, p, 'H', 24, 1, '1019999999999901'), (s, d, p, 'H', 24, 2, '1019999999999902');
  insert into public.supplier_scan_events (supplier_id, dispatch_id, barcode, kind, scanned_at, user_id) values (s, d, '1019999999999901', 'load', now(), u_raj);
  insert into public.supplier_send_plans (supplier_id, number, due_on, created_by) values (s, 1, current_date, u_own) returning id into pl;
  insert into public.supplier_send_plan_lines (plan_id, product_id, carton_type, units_per_carton, cartons) values (pl, p, 'H', 24, 5);
  insert into public.supplier_produce_requests (supplier_id, product_id, stock_units, in_transit_units, min_units, suggested_units) values (s, p, 0, 0, 100, 120);
  insert into public.notifications (user_id, kind, title) values (u_raj, 'test', 'for the supplier'), (u_own, 'test', 'for the owner');
  insert into storage.objects (bucket_id, name) values ('supplier-photos', s || '/' || d || '/rc.jpg');
  -- Give the admin and the supplier login a code request too, so only the owner check can stop them below.
  insert into private.factory_reset_requests (user_id) values (u_adm), (u_raj);

  set local role authenticated;

  -- An admin cannot ask for a code or reset, even holding a fresh code and a request.
  perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method', 'otp', 'timestamp', t)))::text, true);
  blocked := false;
  begin perform public.factory_reset_request(); exception when insufficient_privilege then blocked := true; end;
  assert blocked, 'an admin cannot ask for a reset code';
  blocked := false;
  begin perform public.factory_reset('everything'); exception when insufficient_privilege then blocked := true; end;
  assert blocked, 'an admin cannot reset';

  -- Nor can a supplier login.
  perform set_config('request.jwt.claims', json_build_object('sub', u_raj, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method', 'otp', 'timestamp', t)))::text, true);
  blocked := false;
  begin perform public.factory_reset('activity'); exception when insufficient_privilege then blocked := true; end;
  assert blocked, 'a supplier login cannot reset';

  -- The owner signed in with a password only: refused, even after asking for a code.
  perform set_config('request.jwt.claims', json_build_object('sub', u_own, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method', 'password', 'timestamp', t)))::text, true);
  perform public.factory_reset_request();
  blocked := false;
  begin perform public.factory_reset('everything'); exception when insufficient_privilege then blocked := true; end;
  assert blocked, 'a password session cannot reset';

  -- A code entered 20 minutes ago is too old.
  perform set_config('request.jwt.claims', json_build_object('sub', u_own, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method', 'otp', 'timestamp', t - 1200)))::text, true);
  blocked := false;
  begin perform public.factory_reset('everything'); exception when insufficient_privilege then blocked := true; end;
  assert blocked, 'an old code cannot reset';

  -- A fresh code that was not asked for from the reset page is refused.
  reset role;
  delete from private.factory_reset_requests;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', u_own, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method', 'password', 'timestamp', t - 3600), json_build_object('method', 'otp', 'timestamp', t)))::text, true);
  blocked := false;
  begin perform public.factory_reset('everything'); exception when insufficient_privilege then blocked := true; end;
  assert blocked, 'a code not asked for from the reset page cannot reset';

  -- An unknown level is refused and does not use up the request.
  perform public.factory_reset_request();
  blocked := false;
  begin perform public.factory_reset('all'); exception when invalid_parameter_value then blocked := true; end;
  assert blocked, 'an unknown level is refused';

  -- Test activity: the run goes; suppliers, their logins, products, minimums and the stock copy stay.
  r := public.factory_reset('activity');
  reset role;
  assert (select count(*) from public.supplier_dispatches) = 0, 'activity: dispatches gone';
  assert (select count(*) from public.supplier_dispatch_lines) = 0, 'activity: dispatch lines gone';
  assert (select count(*) from public.supplier_cartons) = 0, 'activity: cartons gone';
  assert (select count(*) from public.supplier_scan_events) = 0, 'activity: scans gone';
  assert (select count(*) from public.supplier_send_plans) = 0 and (select count(*) from public.supplier_send_plan_lines) = 0, 'activity: send plans gone';
  assert (select count(*) from public.supplier_produce_requests) = 0, 'activity: produce requests gone';
  assert (select count(*) from public.notifications) = 0, 'activity: alerts gone';
  assert (select count(*) from public.suppliers where id = s) = 1, 'activity: supplier kept';
  assert (select count(*) from public.profiles where id = u_raj) = 1, 'activity: supplier login kept';
  assert (select count(*) from public.supplier_products where id = p) = 1, 'activity: product kept';
  assert (select count(*) from public.supplier_thresholds where product_id = p) = 1, 'activity: minimum kept';
  assert (select count(*) from public.inventory_stock where code = 'RC-1') = 1, 'activity: stock copy kept';
  assert (r -> 'counts' ->> 'dispatches')::int = 1 and (r -> 'counts' ->> 'cartons')::int = 2 and (r -> 'counts' ->> 'send_plans')::int = 1, 'activity: counts ' || r::text;
  assert r -> 'photos' = jsonb_build_array(s || '/' || d || '/rc.jpg'), 'the photo paths come back for the app to remove';

  -- Each request allows one reset.
  set local role authenticated;
  blocked := false;
  begin perform public.factory_reset('everything'); exception when insufficient_privilege then blocked := true; end;
  assert blocked, 'one code request allows one reset';

  -- Everything: suppliers, their logins, products, minimums and the stock copy go; VRPRIME's own logins stay; the
  -- stock copy is read again straight away.
  perform public.factory_reset_request();
  r := public.factory_reset('everything');
  reset role;
  assert (select count(*) from public.suppliers) = 0, 'everything: suppliers gone';
  assert (select count(*) from auth.users where id = u_raj) = 0 and (select count(*) from public.profiles where id = u_raj) = 0, 'everything: supplier login gone';
  assert (select count(*) from public.profiles where id in (u_own, u_adm)) = 2, 'everything: VRPRIME logins kept';
  assert (select count(*) from auth.users where id in (u_own, u_adm)) = 2, 'everything: VRPRIME sign-ins kept';
  assert (select count(*) from public.supplier_products) = 0 and (select count(*) from public.supplier_thresholds) = 0, 'everything: products and minimums gone';
  assert (select count(*) from public.master_products) = 0 and (select count(*) from public.warehouses) = 0 and (select count(*) from public.inventory_stock) = 0, 'everything: stock copy gone';
  assert (r -> 'counts' ->> 'suppliers')::int = 1 and (r -> 'counts' ->> 'supplier_logins')::int = 1 and (r -> 'counts' ->> 'products')::int = 1, 'everything: counts ' || r::text;
  assert (select last_try_at > now() - interval '1 minute' from public.inventory_sync_state where id), 'everything: the stock copy is read again straight away';
  assert (select count(*) from private.factory_resets) = logged + 2, 'both resets are logged';
  assert (select array_agg(scope order by id) from (select id, scope from private.factory_resets order by id desc limit 2) x) = array['activity', 'everything'], 'the log has both levels';
end $$;

select 'All factory reset checks passed' as result;

rollback;
