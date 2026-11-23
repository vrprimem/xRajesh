-- Factory reset check: authenticator codes are standard TOTP; only the owner can link an app (with a recent password
-- sign-in) and it cannot be swapped once linked; a reset needs the linked app's current code; each code works once;
-- 5 wrong codes lock codes out; 'activity' clears a test run but keeps suppliers, their logins, products, minimums and
-- the stock copy; 'everything' clears those too but keeps VRPRIME's own logins; every reset is logged.
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
  step bigint := floor(extract(epoch from now()) / 30)::bigint;
  rfc bytea := convert_to('12345678901234567890', 'UTF8');
  sec bytea;
  c_prev text;
  c_now text;
  c_next text;
  wrong text := '000000';
  i int;
begin
  if exists (select 1 from public.suppliers) then
    raise exception 'This check runs real resets (rolled back); run it on an empty copy, not the live portal';
  end if;
  logged := (select count(*) from private.factory_resets);

  -- The codes are standard TOTP: RFC 6238's SHA1 test values (last 6 digits).
  assert private.totp_code(rfc, 1) = '287082', 'RFC 6238 at 59 s';
  assert private.totp_code(rfc, 37037036) = '081804', 'RFC 6238 at 1111111109 s';
  assert private.totp_code(rfc, 37037037) = '050471', 'RFC 6238 at 1111111111 s';
  assert private.totp_code(rfc, 41152263) = '005924', 'RFC 6238 at 1234567890 s';
  assert private.totp_code(rfc, 66666666) = '279037', 'RFC 6238 at 2000000000 s';

  -- A small but complete portal.
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
  -- The admin even has a linked app of their own here, so only the owner check can stop them below.
  insert into private.reset_authenticators (user_id, secret, confirmed_at) values (u_adm, rfc, now());

  set local role authenticated;

  -- An admin can neither link an app nor reset, even with a fresh password sign-in and a right code.
  perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method', 'password', 'timestamp', t)))::text, true);
  blocked := false;
  begin perform public.reset_authenticator_begin(); exception when insufficient_privilege then blocked := true; end;
  assert blocked, 'an admin cannot link an app';
  reset role;
  c_now := private.totp_code(rfc, step);
  set local role authenticated;
  blocked := false;
  begin perform public.factory_reset('everything', c_now); exception when insufficient_privilege then blocked := true; end;
  assert blocked, 'an admin cannot reset';

  -- Nor can a supplier login.
  perform set_config('request.jwt.claims', json_build_object('sub', u_raj, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method', 'password', 'timestamp', t)))::text, true);
  blocked := false;
  begin perform public.factory_reset('activity', c_now); exception when insufficient_privilege then blocked := true; end;
  assert blocked, 'a supplier login cannot reset';

  -- The owner: no app linked yet, so no code works.
  perform set_config('request.jwt.claims', json_build_object('sub', u_own, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method', 'password', 'timestamp', t - 3600)))::text, true);
  assert public.reset_authenticator_status() = 'none', 'nothing linked at first';
  r := public.factory_reset('everything', '123456');
  assert r ->> 'ok' = 'false' and r ->> 'reason' = 'missing', 'no reset without a linked app: ' || r::text;

  -- Linking needs a password sign-in in the last 10 minutes.
  blocked := false;
  begin perform public.reset_authenticator_begin(); exception when insufficient_privilege then blocked := true; end;
  assert blocked, 'linking needs a recent password sign-in';
  perform set_config('request.jwt.claims', json_build_object('sub', u_own, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method', 'otp', 'timestamp', t)))::text, true);
  blocked := false;
  begin perform public.reset_authenticator_begin(); exception when insufficient_privilege then blocked := true; end;
  assert blocked, 'linking needs a password sign-in, not another kind';
  perform set_config('request.jwt.claims', json_build_object('sub', u_own, 'role', 'authenticated', 'amr', json_build_array(json_build_object('method', 'password', 'timestamp', t)))::text, true);
  sec := decode(public.reset_authenticator_begin(), 'hex');
  assert length(sec) = 20, 'a 20-byte secret is handed out once';
  assert public.reset_authenticator_status() = 'pending', 'pending until the first code';
  r := public.factory_reset('activity', '123456');
  assert r ->> 'reason' = 'missing', 'no reset while the app is only being set up';

  reset role;
  c_prev := private.totp_code(sec, step - 1);
  c_now := private.totp_code(sec, step);
  c_next := private.totp_code(sec, step + 1);
  while wrong in (c_prev, c_now, c_next) loop
    wrong := lpad((wrong::int + 1)::text, 6, '0');
  end loop;
  set local role authenticated;

  assert public.reset_authenticator_confirm(wrong) = 'wrong', 'a wrong first code does not link the app';
  assert public.reset_authenticator_confirm(c_prev) = 'ok', 'the right first code links the app';
  assert public.reset_authenticator_status() = 'linked', 'linked';
  blocked := false;
  begin perform public.reset_authenticator_begin(); exception when insufficient_privilege then blocked := true; end;
  assert blocked, 'a linked app cannot be swapped from the portal';

  -- Wrong and used codes are refused and nothing is deleted; the 5th wrong code in a row locks codes out.
  r := public.factory_reset('everything', wrong);
  assert r ->> 'reason' = 'wrong', 'a wrong code is refused';
  r := public.factory_reset('everything', c_prev);
  assert r ->> 'reason' = 'wrong', 'a used code is refused';
  for i in 1..3 loop
    r := public.factory_reset('everything', wrong);
  end loop;
  r := public.factory_reset('everything', c_now);
  assert r ->> 'reason' = 'locked', 'after 5 wrong codes even the right one is refused for a while: ' || r::text;
  reset role;
  assert (select count(*) from public.suppliers where id = s) = 1 and (select count(*) from public.supplier_dispatches) = 1, 'refused codes deleted nothing';
  update private.reset_authenticators set locked_until = null where user_id = u_own;
  set local role authenticated;

  -- An unknown level is refused before the code is looked at.
  blocked := false;
  begin perform public.factory_reset('all', c_now); exception when invalid_parameter_value then blocked := true; end;
  assert blocked, 'an unknown level is refused';

  -- Test activity: the run goes; suppliers, their logins, products, minimums and the stock copy stay.
  r := public.factory_reset('activity', c_now);
  assert r ->> 'ok' = 'true', 'activity reset ran: ' || r::text;
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

  -- The code just used cannot be used again.
  set local role authenticated;
  r := public.factory_reset('everything', c_now);
  assert r ->> 'reason' = 'wrong', 'a code works once';

  -- Everything: suppliers, their logins, products, minimums and the stock copy go; VRPRIME's own logins stay; the
  -- stock copy is read again straight away.
  r := public.factory_reset('everything', c_next);
  assert r ->> 'ok' = 'true', 'everything reset ran: ' || r::text;
  reset role;
  assert (select count(*) from public.suppliers) = 0, 'everything: suppliers gone';
  assert (select count(*) from auth.users where id = u_raj) = 0 and (select count(*) from public.profiles where id = u_raj) = 0, 'everything: supplier login gone';
  assert (select count(*) from public.profiles where id in (u_own, u_adm)) = 2, 'everything: VRPRIME logins kept';
  assert (select count(*) from auth.users where id in (u_own, u_adm)) = 2, 'everything: VRPRIME sign-ins kept';
  assert (select count(*) from private.reset_authenticators where user_id = u_own and confirmed_at is not null) = 1, 'everything: the linked app stays linked';
  assert (select count(*) from public.supplier_products) = 0 and (select count(*) from public.supplier_thresholds) = 0, 'everything: products and minimums gone';
  assert (select count(*) from public.master_products) = 0 and (select count(*) from public.warehouses) = 0 and (select count(*) from public.inventory_stock) = 0, 'everything: stock copy gone';
  assert (r -> 'counts' ->> 'suppliers')::int = 1 and (r -> 'counts' ->> 'supplier_logins')::int = 1 and (r -> 'counts' ->> 'products')::int = 1, 'everything: counts ' || r::text;
  assert (select last_try_at > now() - interval '1 minute' from public.inventory_sync_state where id), 'everything: the stock copy is read again straight away';
  assert (select count(*) from private.factory_resets) = logged + 2, 'both resets are logged';
  assert (select array_agg(scope order by id) from (select id, scope from private.factory_resets order by id desc limit 2) x) = array['activity', 'everything'], 'the log has both levels';
end $$;

select 'All factory reset checks passed' as result;

rollback;
