-- Supplier portal check: a supplier login sees its own supplier and nothing else; one supplier never sees another's data;
-- labels, scanning, closing, thresholds and "Produce now" behave as the plan says.
--
-- Runs in one transaction that is rolled back, so it is safe on production and leaves nothing behind.
-- Any failed check raises an error.
--
--   psql "$DATABASE_URL" -f supabase/tests/supplier_check.sql

begin;

do $$
declare
  u_adm uuid := gen_random_uuid();   -- VRPRIME admin
  u_raj uuid := gen_random_uuid();   -- supplier A, owner
  u_scan uuid := gen_random_uuid();  -- supplier A, warehouse person
  u_oth uuid := gen_random_uuid();   -- supplier B, owner
  u_off uuid := gen_random_uuid();   -- supplier A, owner, deactivated
  w_main uuid;
  w_other uuid;
  s_a uuid;
  s_b uuid;
  m_a uuid;
  m_x uuid;
  p_a uuid;
  p_a2 uuid;
  p_b uuid;
  d_a uuid;
  d_b uuid;
  d_c uuid;
  c1 public.supplier_cartons;
  c2 public.supplier_cartons;
  c3 public.supplier_cartons;
  cb public.supplier_cartons;
  q uuid;
  res jsonb;
  n int;
  blocked boolean;
  t text;
  path text;
begin
  insert into public.warehouses (name, vrprime_id) values ('SP Check Main', 'spchk-1') returning id into w_main;
  insert into public.warehouses (name, vrprime_id) values ('SP Check Other', 'spchk-2') returning id into w_other;

  -- On a database with no login yet, the first login made becomes the owner by itself. Make that a throwaway one, so
  -- the check also runs before the real owner exists (it is rolled back with everything else).
  insert into auth.users (id, instance_id, aud, role, email) values
    (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sp-first@example.test');

  insert into auth.users (id, instance_id, aud, role, email) values
    (u_adm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sp-adm@example.test'),
    (u_raj, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sp-raj@example.test'),
    (u_scan, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sp-scan@example.test'),
    (u_oth, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sp-oth@example.test'),
    (u_off, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sp-off@example.test');

  insert into public.suppliers (name, warehouse_id) values ('SP Check Supplier A', w_main) returning id into s_a;
  insert into public.suppliers (name, warehouse_id) values ('SP Check Supplier B', w_main) returning id into s_b;

  insert into public.profiles (id, name, role, active, supplier_id) values
    (u_adm, 'SP Admin', 'admin', true, null),
    (u_raj, 'SP Rajesh', 'supplier_owner', true, s_a),
    (u_scan, 'SP Scanner', 'supplier_scanner', true, s_a),
    (u_oth, 'SP Other', 'supplier_owner', true, s_b),
    (u_off, 'SP Off', 'supplier_owner', false, s_a)
  on conflict (id) do update set name = excluded.name, role = excluded.role, active = excluded.active, supplier_id = excluded.supplier_id;

  -- ---- A supplier login always has a supplier; VRPRIME's own people never do ------------------
  blocked := false;
  begin
    update public.profiles set supplier_id = null where id = u_raj;
  exception when check_violation then blocked := true;
  end;
  assert blocked, 'a supplier login cannot be left without a supplier';
  blocked := false;
  begin
    update public.profiles set supplier_id = s_a where id = u_adm;
  exception when check_violation then blocked := true;
  end;
  assert blocked, 'a VRPRIME user cannot be given a supplier';

  -- Master SKUs and stock: one supplied by A, one that has nothing to do with A.
  insert into public.master_products (name, code) values ('SP Check Product', 'SPCHK-1') returning id into m_a;
  insert into public.master_products (name, code) values ('SP Check Secret', 'SPCHK-X') returning id into m_x;
  insert into public.inventory_stock (code, warehouse_id, pieces)
  select v.code, v.wid, v.pieces
  from (values ('SPCHK-1', w_main, 40), ('SPCHK-1', w_other, 9000), ('SPCHK-X', w_main, 777)) as v(code, wid, pieces);
  update public.inventory_sync_state set last_ok_at = now() where id;

  insert into public.notifications (user_id, kind, title) values (u_adm, 'sp_check', 'for the admin'), (u_raj, 'sp_check', 'for Rajesh');

  -- =====================================================================================
  -- 1. The rest of the app is shut to a supplier login
  -- =====================================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', u_raj, 'role', 'authenticated')::text, true);
  set local role authenticated;

  assert private.user_role() is null, 'a supplier login has no VRPRIME role';
  assert not coalesce(private.is_staff(), false), 'a supplier login is not staff';
  assert private.supplier_role() = 'supplier_owner', 'a supplier owner is known as one';
  assert private.my_supplier() = s_a, 'a supplier login knows its supplier';

  -- Every table in the app except the portal's own, the two shared ones and its own profile row: no rows at all.
  for t in
    select c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
      and c.relname not like 'supplier\_%' and c.relname not in ('suppliers', 'profiles', 'notifications', 'push_subscriptions')
    order by 1
  loop
    begin
      execute format('select count(*) from (select 1 from public.%I limit 1) x', t) into n;
    exception when insufficient_privilege then n := 0;
    end;
    assert n = 0, format('a supplier login must not read %s', t);
  end loop;

  select count(*) into n from public.profiles;
  assert n = 1, 'a supplier login reads its own profile and nobody else''s';
  select count(*) into n from public.notifications;
  assert n = 1, 'a supplier login reads its own notifications only';
  select count(*) into n from public.suppliers;
  assert n = 1, 'a supplier login reads its own supplier only';

  -- It cannot make itself staff, or move to another supplier.
  blocked := false;
  begin
    update public.profiles set role = 'owner', supplier_id = null where id = u_raj;
    get diagnostics n = row_count;
    blocked := n = 0;
  exception when others then blocked := true;
  end;
  assert blocked, 'a supplier login cannot change its own role';
  blocked := false;
  begin
    update public.profiles set supplier_id = s_b where id = u_raj;
    get diagnostics n = row_count;
    blocked := n = 0;
  exception when others then blocked := true;
  end;
  assert blocked, 'a supplier login cannot move to another supplier';

  -- Staff-only buttons refuse it.
  blocked := false;
  begin
    perform public.request_inventory_sync();
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a supplier login cannot start a stock sync';
  blocked := false;
  begin
    perform public.supplier_threshold_set(gen_random_uuid(), 10);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a supplier login cannot set a minimum';

  -- No direct writes to the portal's tables.
  blocked := false;
  begin
    insert into public.supplier_products (supplier_id, name, units_per_carton) values (s_a, 'direct', 10);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'portal tables are not written directly';

  -- =====================================================================================
  -- 2. Products
  -- =====================================================================================
  blocked := false;
  begin
    perform public.supplier_products_save(s_b, '[{"name":"X","units_per_carton":10}]'::jsonb);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a supplier cannot add products to another supplier';

  blocked := false;
  begin
    perform public.supplier_products_save(s_a, '[{"name":"X","master_code":"NO-SUCH-CODE","units_per_carton":10}]'::jsonb);
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'an unknown master SKU refuses the whole list';

  res := public.supplier_products_save(s_a, '[{"name":"SP Kitchen Cleaner","master_code":"spchk-1","category":"kitchen_cleaner","units_per_carton":24,"carton_type":"H"},
                                              {"name":"SP Unlinked","units_per_carton":12,"carton_type":"T"}]'::jsonb);
  assert (res->>'added')::int = 2, 'two products added';
  res := public.supplier_products_save(s_a, '[{"name":"sp kitchen cleaner","master_code":"SPCHK-1","category":"kitchen_cleaner","units_per_carton":20}]'::jsonb);
  assert (res->>'changed')::int = 1 and (res->>'added')::int = 0, 'the same name again updates, never duplicates';
  select id into strict p_a from public.supplier_products where supplier_id = s_a and master_id = m_a;
  select id into strict p_a2 from public.supplier_products where supplier_id = s_a and name = 'SP Unlinked';
  assert (select units_per_carton from public.supplier_products where id = p_a) = 20, 'units per carton updated';

  -- The scanner cannot change products.
  perform set_config('request.jwt.claims', json_build_object('sub', u_scan, 'role', 'authenticated')::text, true);
  blocked := false;
  begin
    perform public.supplier_products_save(s_a, '[{"name":"By scanner","units_per_carton":10}]'::jsonb);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'the warehouse person cannot change products';
  blocked := false;
  begin
    perform public.supplier_dispatch_create(s_a, current_date + 1, null, jsonb_build_array(jsonb_build_object('product_id', p_a, 'cartons', 1)));
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'the warehouse person cannot create a dispatch plan';

  -- =====================================================================================
  -- 3. The stock view: own products, the supplier's warehouse only
  -- =====================================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', u_raj, 'role', 'authenticated')::text, true);
  select count(*) into n from public.supplier_stock(s_a);
  assert n = 2, 'the stock view lists the supplier''s own products only';
  assert (select stock_units from public.supplier_stock(s_a) where product_id = p_a) = 40,
    'stock is the supplier''s warehouse only, never another warehouse';
  assert (select stock_units from public.supplier_stock(s_a) where product_id = p_a2) is null, 'no stock is shown for an unlinked product';
  blocked := false;
  begin
    perform * from public.supplier_stock(s_b);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a supplier cannot open another supplier''s stock view';

  -- =====================================================================================
  -- 4. A dispatch: labels, scanning, void, reprint, photo, close
  -- =====================================================================================
  d_a := public.supplier_dispatch_create(s_a, current_date + 1, 'check',
    jsonb_build_array(jsonb_build_object('product_id', p_a, 'cartons', 3), jsonb_build_object('product_id', p_a2, 'cartons', 2)));
  assert (select number from public.supplier_dispatches where id = d_a) = 1, 'the first dispatch is number 1';
  select count(*) into n from public.supplier_cartons where dispatch_id = d_a;
  assert n = 5, 'exactly one label per planned carton';
  assert (select count(distinct barcode) from public.supplier_cartons where dispatch_id = d_a) = 5, 'every label has its own barcode';
  assert not exists (select 1 from public.supplier_cartons where dispatch_id = d_a and barcode !~ '^9[0-9]{15}$'), 'barcodes are 16 digits starting with 9';
  assert (select array_agg(carton_no order by carton_no) from public.supplier_cartons where dispatch_id = d_a) = array[1, 2, 3, 4, 5], 'cartons are numbered 1 to 5';
  assert (select count(*) from public.supplier_cartons where dispatch_id = d_a and carton_type = 'T' and units = 12) = 2, 'type and units come from the product';

  blocked := false;
  begin
    perform public.supplier_dispatch_create(s_a, current_date + 1, null, jsonb_build_array(jsonb_build_object('product_id', gen_random_uuid(), 'cartons', 1)));
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'a plan with someone else''s product is refused';

  -- Supplier B makes its own dispatch (as B), to try cross-supplier scans.
  perform set_config('request.jwt.claims', json_build_object('sub', u_oth, 'role', 'authenticated')::text, true);
  perform public.supplier_products_save(s_b, '[{"name":"B Product","units_per_carton":6}]'::jsonb);
  select id into strict p_b from public.supplier_products where supplier_id = s_b;
  d_b := public.supplier_dispatch_create(s_b, current_date + 1, null, jsonb_build_array(jsonb_build_object('product_id', p_b, 'cartons', 1)));
  select * into strict cb from public.supplier_cartons where dispatch_id = d_b;
  select count(*) into n from public.supplier_cartons where dispatch_id = d_a;
  assert n = 0, 'supplier B sees none of supplier A''s cartons';
  select count(*) into n from public.supplier_dispatches where id = d_a;
  assert n = 0, 'supplier B sees none of supplier A''s dispatches';
  select count(*) into n from public.supplier_dispatch_lines where dispatch_id = d_a;
  assert n = 0, 'supplier B sees none of supplier A''s dispatch lines';
  select count(*) into n from public.supplier_products where supplier_id = s_a;
  assert n = 0, 'supplier B sees none of supplier A''s products';
  blocked := false;
  begin
    perform public.supplier_scan(d_a, '[]'::jsonb);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'supplier B cannot scan on supplier A''s dispatch';

  -- The warehouse person scans.
  perform set_config('request.jwt.claims', json_build_object('sub', u_scan, 'role', 'authenticated')::text, true);
  -- The three cartons of the linked product, in label order.
  select * into strict c1 from public.supplier_cartons where dispatch_id = d_a and product_id = p_a order by carton_no limit 1;
  select * into strict c2 from public.supplier_cartons where dispatch_id = d_a and product_id = p_a order by carton_no offset 1 limit 1;
  select * into strict c3 from public.supplier_cartons where dispatch_id = d_a and product_id = p_a order by carton_no offset 2 limit 1;

  res := public.supplier_scan(d_a, jsonb_build_array(
    jsonb_build_object('barcode', c1.barcode, 'at', now() - interval '5 minutes'),
    jsonb_build_object('barcode', c1.barcode, 'at', now()),
    jsonb_build_object('barcode', '1234567890123456', 'at', now()),
    jsonb_build_object('barcode', cb.barcode, 'at', now())));
  assert res->0->>'result' = 'loaded', 'a first scan loads the carton';
  assert res->1->>'result' = 'already', 'the same carton twice counts once';
  assert res->2->>'result' = 'unknown', 'an unknown barcode is refused';
  assert res->3->>'result' = 'unknown' and res->3->>'carton_no' is null, 'another supplier''s label is unknown and tells nothing';
  assert (select status from public.supplier_dispatches where id = d_a) = 'loading', 'the first scan starts loading';
  assert (select loaded_by from public.supplier_cartons where id = c1.id) = u_scan, 'who scanned is kept';
  assert (select count(*) from public.supplier_scan_events where dispatch_id = d_a and kind = 'load') = 1, 'one load event';
  assert (select count(*) from public.supplier_scan_events where dispatch_id = d_a and kind = 'refused') = 2, 'refused scans are logged';

  -- Closing is refused until everything is accounted for and the photo is there.
  blocked := false;
  begin
    perform public.supplier_dispatch_close(d_a);
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'a dispatch with unscanned labels cannot be closed';

  -- A damaged label is reprinted: the old one is void, the new one gets the next number.
  perform public.supplier_carton_reprint(c2.id);
  assert (select status from public.supplier_cartons where id = c2.id) = 'void', 'the reprinted label is void';
  assert (select count(*) from public.supplier_cartons where dispatch_id = d_a and carton_no = 6 and replaces = c2.id and status = 'issued') = 1, 'the new label is number 6';
  res := public.supplier_scan(d_a, jsonb_build_array(jsonb_build_object('barcode', c2.barcode, 'at', now())));
  assert res->0->>'result' = 'void', 'a void label is refused';
  blocked := false;
  begin
    perform public.supplier_carton_void(c1.id, 'oops');
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'a loaded carton cannot be voided';

  res := public.supplier_scan(d_a, (select jsonb_agg(jsonb_build_object('barcode', barcode, 'at', now()))
                                    from public.supplier_cartons where dispatch_id = d_a and (id = c3.id or replaces = c2.id)));
  n := public.supplier_dispatch_void_unused(d_a);
  assert n = 2, 'the two unused labels are voided';
  assert not exists (select 1 from public.supplier_cartons where dispatch_id = d_a and status = 'issued'), 'every label is loaded or void';

  blocked := false;
  begin
    perform public.supplier_dispatch_close(d_a);
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'a dispatch without the vehicle photo cannot be closed';

  blocked := false;
  begin
    perform public.supplier_dispatch_set_photo(d_a, s_b::text || '/' || d_a::text || '/' || gen_random_uuid()::text || '.jpg');
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'a photo from another supplier''s folder is refused';
  path := s_a::text || '/' || d_a::text || '/' || gen_random_uuid()::text || '.jpg';
  perform public.supplier_dispatch_set_photo(d_a, path);
  assert private.can_see_supplier_path(path), 'the supplier can open its own photo';
  assert not private.can_see_supplier_path(s_b::text || '/x/y.jpg'), 'and not another supplier''s';
  assert not private.can_see_supplier_path('not-a-uuid/x.jpg'), 'a path that is not a supplier folder is refused';

  perform public.supplier_dispatch_close(d_a);
  assert (select status from public.supplier_dispatches where id = d_a) = 'closed', 'the dispatch is closed';
  res := public.supplier_scan(d_a, jsonb_build_array(jsonb_build_object('barcode', c1.barcode, 'at', now())));
  assert res->0->>'result' = 'closed', 'a closed dispatch takes no more scans';
  blocked := false;
  begin
    perform public.supplier_carton_reprint(c1.id);
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'a closed dispatch is locked';
  blocked := false;
  begin
    perform public.supplier_dispatch_receive(d_a);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'only VRPRIME marks a dispatch received';

  -- In transit: the 3 loaded cartons of the linked product (two originals and the reprint), 20 units each.
  perform set_config('request.jwt.claims', json_build_object('sub', u_raj, 'role', 'authenticated')::text, true);
  assert (select in_transit_units from public.supplier_stock(s_a) where product_id = p_a) = 60, 'loaded cartons of a closed dispatch are in transit';

  -- Cancelling: only a plan with nothing loaded.
  d_c := public.supplier_dispatch_create(s_a, current_date + 2, null, jsonb_build_array(jsonb_build_object('product_id', p_a, 'cartons', 2)));
  assert (select number from public.supplier_dispatches where id = d_c) = 2, 'the next dispatch is number 2';
  perform public.supplier_dispatch_cancel(d_c);
  assert (select count(*) from public.supplier_cartons where dispatch_id = d_c and status = 'void') = 2, 'a cancelled plan voids its labels';

  -- =====================================================================================
  -- 5. Thresholds and "Produce now"
  -- =====================================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role', 'authenticated')::text, true);
  select count(*) into n from public.supplier_products where supplier_id in (s_a, s_b);
  assert n = 3, 'a VRPRIME admin reads every supplier''s products';
  perform public.supplier_threshold_set(p_a, 150);
  reset role;

  -- Stock 40 + in transit 60 = 100, under 150: raised once, with a quantity up to 2 x 150 in full cartons of 20.
  n := private.supplier_produce_check();
  assert n = 1, 'one product is raised';
  n := private.supplier_produce_check();
  assert n = 0, 'it is not raised twice';
  select id into strict q from public.supplier_produce_requests where product_id = p_a and status = 'open';
  assert (select suggested_units from public.supplier_produce_requests where id = q) = 200, 'the suggested quantity fills up to twice the minimum';
  assert (select count(*) from public.notifications where user_id = u_raj and kind = 'supplier_produce') = 1, 'the supplier owner is told once';
  assert (select count(*) from public.notifications where user_id in (u_scan, u_off, u_oth) and kind = 'supplier_produce') = 0,
    'nobody else is told: not the scanner, not a deactivated login, not another supplier';

  perform set_config('request.jwt.claims', json_build_object('sub', u_oth, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.supplier_produce_requests;
  assert n = 0, 'supplier B sees none of supplier A''s requests';
  blocked := false;
  begin
    perform public.supplier_produce_respond(q, 'accepted');
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'supplier B cannot answer supplier A''s request';

  perform set_config('request.jwt.claims', json_build_object('sub', u_raj, 'role', 'authenticated')::text, true);
  perform public.supplier_produce_respond(q, 'in_production');
  assert (select status from public.supplier_produce_requests where id = q) = 'in_production', 'the supplier''s answer is saved';

  -- VRPRIME receives the dispatch: in transit drops to 0 and the request stays (40 < 150).
  perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role', 'authenticated')::text, true);
  perform public.supplier_dispatch_receive(d_a);
  assert (select in_transit_units from public.supplier_stock(s_a) where product_id = p_a) = 0, 'a received dispatch is no longer in transit';
  reset role;
  update public.inventory_stock set pieces = 500 where code = 'SPCHK-1' and warehouse_id = w_main;
  perform private.supplier_produce_check();
  assert (select status from public.supplier_produce_requests where id = q) = 'cleared', 'stock back above the minimum clears the request';

  -- Old stock numbers raise nothing.
  update public.inventory_stock set pieces = 0 where code = 'SPCHK-1' and warehouse_id = w_main;
  update public.inventory_sync_state set last_ok_at = now() - interval '2 days' where id;
  n := private.supplier_produce_check();
  assert n = 0, 'nothing is raised while the stock sync is a day old';

  -- =====================================================================================
  -- 6. A deactivated supplier login, a deactivated supplier, a signed-out visitor
  -- =====================================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', u_off, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.supplier_products;
  assert n = 0, 'a deactivated supplier login sees nothing';
  select count(*) into n from public.notifications;
  assert n = 0, 'a deactivated supplier login reads no notifications';
  reset role;

  update public.suppliers set active = false where id = s_a;
  perform set_config('request.jwt.claims', json_build_object('sub', u_raj, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.supplier_dispatches;
  assert n = 0, 'logins of a deactivated supplier see nothing';
  reset role;
  update public.suppliers set active = true where id = s_a;

  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  blocked := false;
  begin
    select count(*) into n from public.supplier_products;
    blocked := n = 0;
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a signed-out visitor reads nothing';
  reset role;
end $$;

select 'All supplier portal checks passed' as result;

rollback;
