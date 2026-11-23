-- Supplier portal check: a supplier login sees its own supplier and nothing else; one supplier never sees another's data;
-- labels (printed by the inventory software), scanning, closing, arrivals, thresholds and "Produce now" behave as planned;
-- supplies, production and ready stock are the supplier's and VRPRIME's to see, the money the supplier's owner's alone.
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
  dd uuid;
  pl uuid;
  pl2 uuid;
  dp uuid;
  res jsonb;
  lab jsonb;
  n int;
  blocked boolean;
  t text;
  path text;
  i_bottle uuid;
  i_trig uuid;
  i_chem uuid;
  i_box uuid;
  v_a uuid;
  v_b uuid;
  pu uuid;
  co uuid;
  pr1 uuid;
  num numeric;
  ph1 text;
  ph2 text;
  stored boolean;
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
  insert into public.master_products (name, code) values ('SP Check Second', 'SPCHK-2'), ('SP Check B', 'SPCHK-B');
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

  res := public.supplier_products_save(s_a, '[{"name":"SP Kitchen Cleaner","master_code":"spchk-1","category":"kitchen_cleaner","units_per_carton":24,"carton_type":"H","weight_per_carton":8.456},
                                              {"name":"SP Second","master_code":"SPCHK-2","units_per_carton":12,"carton_type":"T"},
                                              {"name":"SP Unlinked","units_per_carton":12,"carton_type":"T"}]'::jsonb);
  assert (res->>'added')::int = 3, 'three products added';
  res := public.supplier_products_save(s_a, '[{"name":"sp kitchen cleaner","master_code":"SPCHK-1","category":"kitchen_cleaner","units_per_carton":20}]'::jsonb);
  assert (res->>'changed')::int = 1 and (res->>'added')::int = 0, 'the same name again updates, never duplicates';
  select id into strict p_a from public.supplier_products where supplier_id = s_a and master_id = m_a;
  select id into strict p_a2 from public.supplier_products where supplier_id = s_a and name = 'SP Second';
  assert (select units_per_carton from public.supplier_products where id = p_a) = 20, 'units per carton updated';
  assert (select weight_per_carton from public.supplier_products where id = p_a) is null, 'saving without a weight clears it';
  perform public.supplier_products_save(s_a, '[{"name":"SP Kitchen Cleaner","master_code":"SPCHK-1","category":"kitchen_cleaner","units_per_carton":20,"weight_per_carton":8.456}]'::jsonb);
  assert (select weight_per_carton from public.supplier_products where id = p_a) = 8.46, 'carton weight is kept in kg, to 2 places';
  blocked := false;
  begin
    perform public.supplier_products_save(s_a, '[{"name":"SP Kitchen Cleaner","units_per_carton":20,"weight_per_carton":-1}]'::jsonb);
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'a carton weight of 0 or less is refused';

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
  assert n = 3, 'the stock view lists the supplier''s own products only';
  assert (select stock_units from public.supplier_stock(s_a) where product_id = p_a) = 40,
    'stock is the supplier''s warehouse only, never another warehouse';
  assert (select stock_units from public.supplier_stock(s_a) where name = 'SP Unlinked') is null, 'no stock is shown for an unlinked product';
  blocked := false;
  begin
    perform * from public.supplier_stock(s_b);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a supplier cannot open another supplier''s stock view';

  -- =====================================================================================
  -- 4. A dispatch: labels, scanning, void, reprint, photo, close
  -- =====================================================================================
  blocked := false;
  begin
    perform public.supplier_dispatch_create(s_a, current_date + 1, null, jsonb_build_array(jsonb_build_object(
      'product_id', (select id from public.supplier_products where supplier_id = s_a and name = 'SP Unlinked'), 'cartons', 1)));
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'a product with no master SKU cannot go on a plan (the inventory software prints its labels)';

  d_a := public.supplier_dispatch_create(s_a, current_date + 1, 'check',
    jsonb_build_array(jsonb_build_object('product_id', p_a, 'cartons', 3), jsonb_build_object('product_id', p_a2, 'cartons', 2)));
  assert (select number from public.supplier_dispatches where id = d_a) = 1, 'the first dispatch is number 1';
  select count(*) into n from public.supplier_cartons where dispatch_id = d_a;
  assert n = 0, 'a new plan has no labels until the inventory software prints them';
  blocked := false;
  begin
    perform public.supplier_labels_save(d_a, '[]'::jsonb);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'nobody signed in can add labels by hand';
  blocked := false;
  begin
    perform public.supplier_labels_claim(d_a);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'nobody signed in can take a label run';

  -- The Edge Function's part, done here by hand: claim, save what the inventory software printed, finish.
  reset role;
  res := public.supplier_labels_claim(d_a);
  assert res->>'warehouse_vid' = 'spchk-1', 'labels are asked for at the supplier''s warehouse';
  assert jsonb_array_length(res->'lines') = 2 and (select sum((l->>'need')::int) from jsonb_array_elements(res->'lines') l) = 5,
    'one label is owed per planned carton';
  assert (select count(*) from jsonb_array_elements(res->'lines') l where l->>'sku' in ('SPCHK-1', 'SPCHK-2')) = 2, 'each line names the inventory software''s product';
  assert (select (l->>'weight')::numeric from jsonb_array_elements(res->'lines') l where l->>'sku' = 'SPCHK-1') = 8.46, 'the carton weight goes to the inventory software with the labels';
  assert (select l->'weight' from jsonb_array_elements(res->'lines') l where l->>'sku' = 'SPCHK-2') = 'null'::jsonb, 'a product with no weight sends none';
  assert public.supplier_labels_claim(d_a) is null, 'a second run cannot take the dispatch while the first is working';
  select jsonb_agg(to_jsonb(x)) into lab from (
    select l.product_id, l.carton_type, l.units_per_carton as units,
           '101' || lpad((1000 + row_number() over ())::text, 13, '0') as serial, '<svg/>' as svg
    from public.supplier_dispatch_lines l, generate_series(1, l.cartons) g where l.dispatch_id = d_a) x;
  n := public.supplier_labels_save(d_a, lab);
  assert n = 5, 'the five printed labels are saved';
  assert (select count(*) from public.supplier_cartons where dispatch_id = d_a and product_id = p_a and weight_per_carton = 8.46) = 3, 'each label carries its carton weight';
  n := public.supplier_labels_save(d_a, lab);
  assert n = 0, 'the same labels sent twice are saved once';
  n := public.supplier_labels_save(d_a, jsonb_build_array(jsonb_build_object('product_id', p_a, 'carton_type', 'H', 'units', 20, 'serial', '1010000000009999', 'svg', null)));
  assert n = 0, 'never more labels than the plan needs';
  perform public.supplier_labels_done(d_a, null);
  assert public.supplier_labels_claim(d_a) is null, 'nothing more is asked for once every carton has its label';
  set local role authenticated;
  select count(*) into n from public.supplier_cartons where dispatch_id = d_a;
  assert n = 5, 'exactly one label per planned carton';
  assert (select count(distinct barcode) from public.supplier_cartons where dispatch_id = d_a) = 5, 'every label has its own barcode';
  assert not exists (select 1 from public.supplier_cartons where dispatch_id = d_a and barcode !~ '^1[0-9]{15}$'), 'barcodes are the inventory software''s 16-digit numbers';
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
  perform public.supplier_products_save(s_b, '[{"name":"B Product","master_code":"SPCHK-B","units_per_carton":6}]'::jsonb);
  select id into strict p_b from public.supplier_products where supplier_id = s_b;
  d_b := public.supplier_dispatch_create(s_b, current_date + 1, null, jsonb_build_array(jsonb_build_object('product_id', p_b, 'cartons', 1)));
  reset role;
  n := public.supplier_labels_save(d_b, jsonb_build_array(jsonb_build_object('product_id', p_b, 'carton_type', 'H', 'units', 6, 'serial', '1019999999999991', 'svg', null)));
  set local role authenticated;
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

  -- A damaged label is reprinted: the old one is void, and one new label is asked for; it gets the next number.
  perform public.supplier_carton_reprint(c2.id);
  assert (select status from public.supplier_cartons where id = c2.id) = 'void', 'the reprinted label is void';
  reset role;
  res := public.supplier_labels_claim(d_a);
  assert jsonb_array_length(res->'lines') = 1 and (res->'lines'->0->>'need')::int = 1 and res->'lines'->0->>'sku' = 'SPCHK-1',
    'one new label is owed for the reprint';
  n := public.supplier_labels_save(d_a, jsonb_build_array(jsonb_build_object('product_id', p_a, 'carton_type', c2.carton_type, 'units', c2.units, 'serial', '1010000000002001', 'svg', null)));
  perform public.supplier_labels_done(d_a, null);
  set local role authenticated;
  assert (select count(*) from public.supplier_cartons where dispatch_id = d_a and carton_no = 6 and barcode = '1010000000002001' and status = 'issued') = 1, 'the new label is number 6';
  res := public.supplier_scan(d_a, jsonb_build_array(jsonb_build_object('barcode', c2.barcode, 'at', now())));
  assert res->0->>'result' = 'void', 'a void label is refused';
  blocked := false;
  begin
    perform public.supplier_carton_void(c1.id, 'oops');
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'a loaded carton cannot be voided';

  res := public.supplier_scan(d_a, (select jsonb_agg(jsonb_build_object('barcode', barcode, 'at', now()))
                                    from public.supplier_cartons where dispatch_id = d_a and (id = c3.id or barcode = '1010000000002001')));
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
  assert (select status from public.supplier_dispatches where id = d_c) = 'cancelled', 'a plan with nothing loaded can be cancelled';

  -- =====================================================================================
  -- 5. Thresholds and "Produce now"
  -- =====================================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role', 'authenticated')::text, true);
  select count(*) into n from public.supplier_products where supplier_id in (s_a, s_b);
  assert n = 4, 'a VRPRIME admin reads every supplier''s products';
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

  -- The warehouse scans the cartons in with the inventory software; the sync sees it and marks them arrived here.
  perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role', 'authenticated')::text, true);
  blocked := false;
  begin
    perform public.supplier_receive_save('[]'::jsonb);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'nobody signed in can mark cartons as arrived through the sync''s door';
  reset role;
  res := public.supplier_receive_plan();
  assert jsonb_array_length(res) = 1 and res->0->>'sku' = 'SPCHK-1' and jsonb_array_length(res->0->'serials') = 3,
    'the three loaded cartons of the closed dispatch are waited for';
  res := public.supplier_receive_save(jsonb_build_array(c1.barcode, cb.barcode, '1010000000000000'));
  assert (res->>'marked')::int = 1 and (res->>'dispatches_received')::int = 0, 'one carton has arrived; a label that was never loaded changes nothing';
  assert (select in_transit_units from public.supplier_stock(s_a) where product_id = p_a) = 40, 'an arrived carton is no longer in transit';
  res := public.supplier_receive_save((select jsonb_agg(barcode) from public.supplier_cartons where dispatch_id = d_a and status = 'loaded'));
  assert (res->>'marked')::int = 2 and (res->>'dispatches_received')::int = 1, 'the rest arrive and the dispatch completes by itself';
  assert (select status from public.supplier_dispatches where id = d_a) = 'received', 'the dispatch is received';
  set local role authenticated;
  assert (select in_transit_units from public.supplier_stock(s_a) where product_id = p_a) = 0, 'a received dispatch is no longer in transit';
  reset role;
  update public.inventory_stock set pieces = 500 where code = 'SPCHK-1' and warehouse_id = w_main;
  perform private.supplier_produce_check();
  assert (select status from public.supplier_produce_requests where id = q) = 'cleared', 'stock back above the minimum clears the request';

  -- Send plans: VRPRIME says what to send next; the supplier answers and turns it into a dispatch.
  perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  pl := public.supplier_plan_create(s_a, (now() at time zone 'Asia/Kolkata')::date + 3, 'week 48',
    jsonb_build_array(jsonb_build_object('product_id', p_a, 'cartons', 4), jsonb_build_object('product_id', p_a, 'cartons', 2)));
  assert (select count(*) from public.supplier_send_plan_lines where plan_id = pl) = 1, 'the same product twice is one line';
  assert (select cartons from public.supplier_send_plan_lines where plan_id = pl) = 6 and (select units_per_carton from public.supplier_send_plan_lines where plan_id = pl) = 20, 'cartons add up; units per carton from the product';
  assert (select number from public.supplier_send_plans where id = pl) = 1, 'the first plan is number 1';
  blocked := false;
  begin
    perform public.supplier_plan_create(s_a, current_date - 3, null, jsonb_build_array(jsonb_build_object('product_id', p_a, 'cartons', 1)));
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'a plan cannot be due in the past';
  reset role;
  assert (select count(*) from public.notifications where kind = 'supplier_plan' and user_id = u_raj) = 1, 'the supplier owner is told of the plan';
  assert (select count(*) from public.notifications where kind = 'supplier_plan' and user_id in (u_scan, u_oth, u_off)) = 0, 'nobody else is';

  perform set_config('request.jwt.claims', json_build_object('sub', u_raj, 'role', 'authenticated')::text, true);
  set local role authenticated;
  blocked := false;
  begin
    perform public.supplier_plan_create(s_a, current_date + 3, null, jsonb_build_array(jsonb_build_object('product_id', p_a, 'cartons', 1)));
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'only VRPRIME makes a send plan';
  select count(*) into n from public.supplier_send_plan_lines where plan_id = pl;
  assert n = 1, 'the supplier reads its plan''s lines';
  perform public.supplier_plan_respond(pl, 'accepted');
  assert (select status from public.supplier_send_plans where id = pl) = 'accepted', 'the supplier accepts';
  blocked := false;
  begin
    perform public.supplier_plan_respond(pl, 'shipped');
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'an unknown answer is refused';
  blocked := false;
  begin
    perform public.supplier_plan_cancel(pl);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'only VRPRIME cancels a plan';

  perform set_config('request.jwt.claims', json_build_object('sub', u_scan, 'role', 'authenticated')::text, true);
  blocked := false;
  begin
    perform public.supplier_plan_respond(pl, 'ready');
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'the warehouse person does not answer plans';

  perform set_config('request.jwt.claims', json_build_object('sub', u_oth, 'role', 'authenticated')::text, true);
  select count(*) into n from public.supplier_send_plans;
  assert n = 0, 'another supplier sees none of these plans';
  blocked := false;
  begin
    perform public.supplier_plan_to_dispatch(pl);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'another supplier cannot turn it into a dispatch';

  perform set_config('request.jwt.claims', json_build_object('sub', u_raj, 'role', 'authenticated')::text, true);
  dp := public.supplier_plan_to_dispatch(pl);
  assert (select status from public.supplier_send_plans where id = pl) = 'dispatched' and (select dispatch_id from public.supplier_send_plans where id = pl) = dp, 'the plan becomes a dispatch';
  assert (select cartons from public.supplier_dispatch_lines where dispatch_id = dp and product_id = p_a) = 6, 'with exactly the plan''s cartons';
  assert (select note from public.supplier_dispatches where id = dp) like 'From VRPRIME send plan 1%', 'and says where it came from';
  blocked := false;
  begin
    perform public.supplier_plan_to_dispatch(pl);
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'a plan becomes a dispatch once';
  reset role;
  assert (select count(*) from public.notifications where kind = 'supplier_plan_answer' and user_id = u_adm) = 2, 'VRPRIME hears the answer and the dispatch';

  perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role', 'authenticated')::text, true);
  set local role authenticated;
  pl2 := public.supplier_plan_create(s_a, (now() at time zone 'Asia/Kolkata')::date + 5, null, jsonb_build_array(jsonb_build_object('product_id', p_a2, 'cartons', 3)));
  assert (select number from public.supplier_send_plans where id = pl2) = 2, 'the next plan is number 2';
  perform public.supplier_plan_cancel(pl2);
  assert (select status from public.supplier_send_plans where id = pl2) = 'cancelled', 'VRPRIME cancels a plan';
  reset role;
  assert (select count(*) from public.notifications where kind = 'supplier_plan' and user_id = u_raj and title like '%cancelled%') = 1, 'and the supplier is told';

  -- Dispatch due: the supplier's owner and warehouse person hear about an open dispatch due tomorrow, once a day.
  perform set_config('request.jwt.claims', json_build_object('sub', u_raj, 'role', 'authenticated')::text, true);
  set local role authenticated;
  dd := public.supplier_dispatch_create(s_a, (now() at time zone 'Asia/Kolkata')::date + 1, null, jsonb_build_array(jsonb_build_object('product_id', p_a, 'cartons', 1)));
  reset role;
  update public.supplier_dispatches set due_on = (now() at time zone 'Asia/Kolkata')::date + 1 where id = d_b;
  n := private.supplier_dispatch_due();
  assert n >= 2, 'both open dispatches due tomorrow are told about (one of each supplier; real ones may be due too)';
  assert (select count(*) from public.notifications where kind = 'supplier_due' and user_id = u_raj and title like '%due tomorrow') = 1, 'the supplier owner hears';
  assert (select count(*) from public.notifications where kind = 'supplier_due' and user_id = u_scan) = 1, 'the warehouse person hears';
  assert (select count(*) from public.notifications where kind = 'supplier_due' and user_id = u_oth) = 1, 'the other supplier hears only of its own';
  assert (select count(*) from public.notifications where kind = 'supplier_due' and user_id in (u_off, u_adm)) = 0, 'not a deactivated login, not VRPRIME';
  n := private.supplier_dispatch_due();
  assert n = 0, 'once a day';
  update public.supplier_dispatches set due_on = due_on - 5, due_alerted_on = null where id = dd;
  n := private.supplier_dispatch_due();
  assert n = 1 and (select count(*) from public.notifications where kind = 'supplier_due' and user_id = u_raj and title like '%overdue%') = 1, 'an overdue dispatch is told as overdue';
  blocked := false;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', u_raj, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform private.supplier_dispatch_due();
  exception when insufficient_privilege then blocked := true;
  end;
  reset role;
  assert blocked, 'nobody signed in can run the job';

  -- Old stock numbers raise nothing.
  update public.inventory_stock set pieces = 0 where code = 'SPCHK-1' and warehouse_id = w_main;
  update public.inventory_sync_state set last_ok_at = now() - interval '2 days' where id;
  n := private.supplier_produce_check();
  assert n = 0, 'nothing is raised while the stock sync is a day old';

  -- =====================================================================================
  -- 6. Master SKU search: by any words of the name or code; VRPRIME and a supplier's owner only
  -- =====================================================================================
  insert into public.master_products (code, name) values
    ('SPCHK-KC-500', 'SP Check Kitchen Cleaner Spray 500ml'),
    ('SPCHK-GC-500', 'SP Check Glass Cleaner 500ml'),
    ('SPCHK-RR-300', 'SP Check Rat Repellent 300ml');
  insert into public.master_products (code, name) select 'SPCHK-BULK-' || g, 'SP Check Bulk Item ' || g from generate_series(1, 30) g;

  perform set_config('request.jwt.claims', json_build_object('sub', u_raj, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.master_products;
  assert n = 0, 'a supplier login still cannot read the master SKU list itself';
  select count(*) into n from public.master_sku_search('sp check cleaner');
  assert n = 2, 'a word finds every master SKU that has it: ' || n;
  select count(*) into n from public.master_sku_search('SP CHECK   clean kitchen');
  assert n = 1, 'every word must match, in any order, case ignored';
  select code into t from public.master_sku_search('sp check glass');
  assert t = 'SPCHK-GC-500', 'the right master SKU comes back';
  select count(*) into n from public.master_sku_search('spchk-rr');
  assert n = 1, 'codes match too';
  select count(*) into n from public.master_sku_search('c');
  assert n = 0, 'one letter is too short to search';
  select count(*) into n from public.master_sku_search('sp check %');
  assert n = 0, 'a typed % is plain text, not a wildcard';
  select count(*) into n from public.master_sku_search('sp check bulk');
  assert n = 25, 'at most 25 matches';

  perform set_config('request.jwt.claims', json_build_object('sub', u_scan, 'role', 'authenticated')::text, true);
  blocked := false;
  begin
    select count(*) into n from public.master_sku_search('sp check cleaner');
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'the warehouse person cannot search master SKUs';

  perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role', 'authenticated')::text, true);
  select count(*) into n from public.master_sku_search('sp check cleaner');
  assert n = 2, 'VRPRIME can search too';
  reset role;

  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  blocked := false;
  begin
    select count(*) into n from public.master_sku_search('sp check cleaner');
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a signed-out visitor cannot search master SKUs';
  reset role;

  -- =====================================================================================
  -- 7. Supplies, money, production and ready stock
  -- =====================================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', u_raj, 'role', 'authenticated')::text, true);
  set local role authenticated;
  blocked := false;
  begin
    perform public.supplier_item_save(s_b, jsonb_build_object('name', 'SP Sneaky', 'kind', 'bottle'));
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a supplier cannot add supplies to another supplier';
  i_bottle := public.supplier_item_save(s_a, jsonb_build_object('name', 'SP Bottle 500ml', 'kind', 'bottle', 'unit', 'pcs', 'low_level', 100));
  i_trig := public.supplier_item_save(s_a, jsonb_build_object('name', 'SP Trigger', 'kind', 'trigger'));
  i_chem := public.supplier_item_save(s_a, jsonb_build_object('name', 'SP Kitchen chemical', 'kind', 'chemical', 'unit', 'litre'));
  i_box := public.supplier_item_save(s_a, jsonb_build_object('name', 'SP Hard carton', 'kind', 'carton_hard'));
  blocked := false;
  begin
    perform public.supplier_item_save(s_a, jsonb_build_object('name', ' sp bottle 500ML ', 'kind', 'bottle'));
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'two supplies cannot share a name';
  blocked := false;
  begin
    perform public.supplier_item_save(s_a, jsonb_build_object('name', 'SP Odd', 'kind', 'bottle', 'unit', 'dozen'));
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'an unknown unit is refused';

  -- Vendors, purchases, payments and costs: the supplier's owner's.
  v_a := public.supplier_vendor_save(s_a, jsonb_build_object('name', 'SP Plastics', 'phone', '98200 00000'));
  v_b := public.supplier_vendor_save(s_a, jsonb_build_object('name', 'SP Chemicals'));
  -- 1,000 bottles at 4.50 + 18% GST = 5,310, received today.
  pu := public.supplier_purchase_save(s_a, jsonb_build_object('vendor_id', v_a, 'item_id', i_bottle, 'bought_on', current_date, 'qty', 1000, 'rate', 4.5, 'gst_pct', 18, 'received_on', current_date));
  assert (select amount from public.supplier_purchases where id = pu) = 5310, 'a purchase''s amount is quantity x rate + GST';
  -- 1,000 triggers at 3, ordered but not received yet.
  perform public.supplier_purchase_save(s_a, jsonb_build_object('vendor_id', v_a, 'item_id', i_trig, 'bought_on', current_date, 'qty', 1000, 'rate', 3));
  perform public.supplier_purchase_save(s_a, jsonb_build_object('vendor_id', v_b, 'item_id', i_chem, 'bought_on', current_date, 'qty', 200, 'rate', 50, 'received_on', current_date));
  perform public.supplier_purchase_save(s_a, jsonb_build_object('vendor_id', v_b, 'item_id', i_box, 'bought_on', current_date, 'qty', 100, 'rate', 20, 'received_on', current_date));
  perform public.supplier_payment_save(s_a, jsonb_build_object('vendor_id', v_a, 'paid_on', current_date, 'amount', 2000, 'mode', 'upi'));
  co := public.supplier_cost_save(s_a, jsonb_build_object('spent_on', current_date, 'kind', 'labour', 'qty', 4, 'rate', 500));
  assert (select amount from public.supplier_costs where id = co) = 2000, 'labour: 4 workers at 500 is 2,000';
  perform public.supplier_cost_save(s_a, jsonb_build_object('spent_on', current_date, 'kind', 'hamali', 'amount', 350.5));
  blocked := false;
  begin
    perform public.supplier_cost_save(s_a, jsonb_build_object('spent_on', current_date, 'kind', 'labour', 'qty', 4));
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'a count needs its rate';
  blocked := false;
  begin
    perform public.supplier_purchase_save(s_a, jsonb_build_object('vendor_id', v_a, 'item_id', i_bottle, 'bought_on', current_date, 'qty', 10, 'rate', 1, 'received_on', current_date - 1));
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'goods cannot arrive before they were bought';
  blocked := false;
  begin
    perform public.supplier_payment_save(s_a, jsonb_build_object('vendor_id', v_a, 'paid_on', current_date + 60, 'amount', 1));
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'a payment two months ahead is refused';

  select due into num from public.supplier_vendor_balances(s_a) where id = v_a;
  assert num = 5310 + 3000 - 2000, 'a vendor''s dues are what was bought minus what was paid: ' || num;
  select count(*) into n from public.supplier_vendor_balances(s_a);
  assert n = 2, 'both vendors are listed';

  select on_hand into num from public.supplier_item_stock(s_a) where id = i_bottle;
  assert num = 1000, 'received bottles are in stock';
  select on_hand into num from public.supplier_item_stock(s_a) where id = i_trig;
  assert num = 0, 'triggers not received yet are not in stock';
  -- They arrive: the purchase is changed, and the stock follows it.
  perform public.supplier_purchase_save(s_a, (select jsonb_build_object('id', id, 'vendor_id', vendor_id, 'item_id', item_id, 'bought_on', bought_on, 'qty', qty, 'rate', rate, 'received_on', current_date)
                                              from public.supplier_purchases where item_id = i_trig));
  select on_hand into num from public.supplier_item_stock(s_a) where id = i_trig;
  assert num = 1000, 'triggers are in stock once received';
  select count(*) into n from public.supplier_item_moves where item_id = i_trig;
  assert n = 1, 'a changed purchase keeps one stock move';

  -- The warehouse person: supplies and their stock, no money.
  perform set_config('request.jwt.claims', json_build_object('sub', u_scan, 'role', 'authenticated')::text, true);
  select count(*) into n from public.supplier_items;
  assert n = 4, 'the warehouse person sees the supplies';
  select (select count(*) from public.supplier_purchases) + (select count(*) from public.supplier_payments)
       + (select count(*) from public.supplier_costs) + (select count(*) from public.supplier_vendors) into n;
  assert n = 0, 'the warehouse person sees no purchases, payments, costs or vendors';
  blocked := false;
  begin
    perform public.supplier_vendor_balances(s_a);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'the warehouse person cannot see what is owed';
  blocked := false;
  begin
    perform public.supplier_cost_save(s_a, jsonb_build_object('spent_on', current_date, 'kind', 'hamali', 'amount', 10));
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'the warehouse person cannot enter costs';
  blocked := false;
  begin
    perform public.supplier_item_save(s_a, jsonb_build_object('name', 'SP Scanner item'));
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'the warehouse person cannot add supplies';
  num := public.supplier_item_count(i_box, 90, 'counted');
  assert num = -10, 'a count sets the stock: 100 counted as 90';
  select on_hand into num from public.supplier_item_stock(s_a) where id = i_box;
  assert num = 90, 'the count stands';

  -- VRPRIME: the supplies and their stock (no prices), none of the money.
  perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role', 'authenticated')::text, true);
  select count(*) into n from public.supplier_items where supplier_id = s_a;
  assert n = 4, 'VRPRIME sees the supplies';
  select (select count(*) from public.supplier_purchases) + (select count(*) from public.supplier_payments)
       + (select count(*) from public.supplier_costs) + (select count(*) from public.supplier_vendors) into n;
  assert n = 0, 'VRPRIME sees none of the supplier''s purchases, payments, costs or vendors';
  blocked := false;
  begin
    perform public.supplier_vendor_balances(s_a);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'VRPRIME cannot see what the supplier owes';
  blocked := false;
  begin
    perform public.supplier_payment_save(s_a, jsonb_build_object('vendor_id', v_a, 'paid_on', current_date, 'amount', 1));
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'VRPRIME cannot enter the supplier''s payments';

  -- Another supplier: nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', u_oth, 'role', 'authenticated')::text, true);
  select (select count(*) from public.supplier_items) + (select count(*) from public.supplier_item_moves) into n;
  assert n = 0, 'another supplier sees none of these supplies';
  blocked := false;
  begin
    perform public.supplier_item_count(i_box, 1);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'another supplier cannot count these supplies';
  blocked := false;
  begin
    perform public.supplier_purchase_delete(pu);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'another supplier cannot remove these purchases';

  -- Recipes and production: 1 bottle, 1 trigger and 0.5 litre a unit; 1 hard carton per carton of 20.
  perform set_config('request.jwt.claims', json_build_object('sub', u_raj, 'role', 'authenticated')::text, true);
  n := public.supplier_recipe_save(p_a, jsonb_build_array(
    jsonb_build_object('item_id', i_bottle, 'qty', 1, 'per', 'unit'),
    jsonb_build_object('item_id', i_trig, 'qty', 1),
    jsonb_build_object('item_id', i_chem, 'qty', 0.5),
    jsonb_build_object('item_id', i_box, 'qty', 1, 'per', 'carton')));
  assert n = 4, 'the recipe has four supplies';
  blocked := false;
  begin
    perform public.supplier_recipe_save(p_a, jsonb_build_array(jsonb_build_object('item_id', i_bottle, 'qty', 1), jsonb_build_object('item_id', i_bottle, 'qty', 2)));
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'a supply cannot be in a recipe twice';
  assert (select count(*) from public.supplier_recipes where product_id = p_a) = 4, 'a refused recipe leaves the old one';

  pr1 := public.supplier_production_save(jsonb_build_object('product_id', p_a, 'made_on', current_date, 'units', 100));
  select on_hand into num from public.supplier_item_stock(s_a) where id = i_bottle;
  assert num = 900, '100 units made use 100 bottles';
  select on_hand into num from public.supplier_item_stock(s_a) where id = i_chem;
  assert num = 150, '... and 50 litres';
  select on_hand into num from public.supplier_item_stock(s_a) where id = i_box;
  assert num = 85, '... and 5 cartons of 20';
  perform public.supplier_production_save(jsonb_build_object('id', pr1, 'product_id', p_a, 'made_on', current_date, 'units', 40));
  select on_hand into num from public.supplier_item_stock(s_a) where id = i_box;
  assert num = 88, 'a changed entry takes what the new figure used: 2 cartons';
  perform public.supplier_production_delete(pr1);
  select on_hand into num from public.supplier_item_stock(s_a) where id = i_bottle;
  assert num = 1000, 'a removed entry gives its supplies back';
  blocked := false;
  begin
    perform public.supplier_production_save(jsonb_build_object('product_id', p_a, 'made_on', current_date + 1, 'units', 10));
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'production cannot be entered for tomorrow';
  blocked := false;
  begin
    perform public.supplier_production_save(jsonb_build_object('product_id', p_a, 'made_on', current_date, 'units', 1.5));
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'units made are whole';

  -- Ready stock: made, minus what was loaded since the first production day, plus counts.
  perform public.supplier_production_save(jsonb_build_object('product_id', p_a, 'made_on', current_date, 'units', 500));
  perform public.supplier_production_save(jsonb_build_object('product_id', p_a, 'made_on', current_date - 1, 'units', 300));
  select coalesce(sum(k.units), 0) into n from public.supplier_cartons k join public.supplier_dispatches d on d.id = k.dispatch_id
   where k.product_id = p_a and k.status = 'loaded' and d.status <> 'cancelled';
  assert n > 0, 'the check has loaded cartons to take off';
  assert (select ready from public.supplier_ready_stock(s_a) where product_id = p_a) = 800 - n, 'ready stock is made minus loaded';
  assert (select made_7d = 800 and made_30d = 800 and days_30d = 2 and last_made_on = current_date from public.supplier_ready_stock(s_a) where product_id = p_a),
    'made in the last 7 and 30 days, on 2 days';
  reset role;
  update public.supplier_cartons set loaded_at = now() - interval '5 days' where product_id = p_a and status = 'loaded';
  set local role authenticated;
  assert (select ready from public.supplier_ready_stock(s_a) where product_id = p_a) = 800, 'goods loaded before the first production day are not taken off';
  n := public.supplier_stock_count(p_a, 750, 'counted');
  assert n = -50, 'a count corrects the ready stock: 800 counted as 750';
  assert (select ready from public.supplier_ready_stock(s_a) where product_id = p_a) = 750, 'the count stands';
  -- A first count starts the tracking that day; what was loaded earlier the same day is already out of the count.
  perform public.supplier_stock_count(p_a2, 30);
  assert (select ready from public.supplier_ready_stock(s_a) where product_id = p_a2) = 30, 'a first count is the ready stock';

  -- The warehouse person enters production and counts, not recipes.
  perform set_config('request.jwt.claims', json_build_object('sub', u_scan, 'role', 'authenticated')::text, true);
  perform public.supplier_production_save(jsonb_build_object('product_id', p_a, 'made_on', current_date, 'units', 10));
  assert (select ready from public.supplier_ready_stock(s_a) where product_id = p_a) = 760, 'the warehouse person''s production counts';
  blocked := false;
  begin
    perform public.supplier_recipe_save(p_a, '[]'::jsonb);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'the warehouse person cannot change recipes';

  -- VRPRIME sees production and ready stock; another supplier does not.
  perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role', 'authenticated')::text, true);
  select count(*) into n from public.supplier_production where supplier_id = s_a;
  assert n = 3, 'VRPRIME sees every production entry';
  assert (select ready from public.supplier_ready_stock(s_a) where product_id = p_a) = 760, 'VRPRIME sees the ready stock';
  perform set_config('request.jwt.claims', json_build_object('sub', u_oth, 'role', 'authenticated')::text, true);
  select (select count(*) from public.supplier_production) + (select count(*) from public.supplier_recipes) + (select count(*) from public.supplier_stock_counts) into n;
  assert n = 0, 'another supplier sees none of this production';
  blocked := false;
  begin
    perform public.supplier_ready_stock(s_a);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'another supplier cannot read this ready stock';
  blocked := false;
  begin
    perform public.supplier_production_save(jsonb_build_object('product_id', p_a, 'made_on', current_date, 'units', 10));
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'another supplier cannot enter this production';
  reset role;

  -- =====================================================================================
  -- 8. Product photos: one per master SKU; VRPRIME sets them, a supplier with that product sees them
  -- =====================================================================================
  reset role;
  ph1 := gen_random_uuid()::text || '.jpg';
  ph2 := gen_random_uuid()::text || '.jpg';
  -- A photo for the master SKU of Rajesh's product, and one for a master SKU no supplier has. Put in directly: the
  -- files themselves are not needed to check who sees what.
  insert into public.master_photos (code, path) values ('SPCHK-1', ph1), ('SPCHK-X', gen_random_uuid()::text || '.jpg');

  perform set_config('request.jwt.claims', json_build_object('sub', u_raj, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.master_photos;
  assert n = 1, 'a supplier sees the photos of its own products'' master SKUs only';
  assert (select x.path from public.supplier_product_photos(s_a) x where x.product_id = p_a) = ph1, 'its product comes with its photo';
  assert private.can_see_photo_file(ph1), 'the supplier may open its product''s photo file';
  blocked := false;
  begin
    perform public.master_photo_set('SPCHK-1', ph2);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a supplier cannot set photos';
  blocked := false;
  begin
    perform public.master_photo_remove('SPCHK-1');
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a supplier cannot remove photos';

  perform set_config('request.jwt.claims', json_build_object('sub', u_scan, 'role', 'authenticated')::text, true);
  select count(*) into n from public.master_photos;
  assert n = 1, 'the warehouse person sees them too';

  perform set_config('request.jwt.claims', json_build_object('sub', u_oth, 'role', 'authenticated')::text, true);
  select count(*) into n from public.master_photos;
  assert n = 0, 'another supplier sees none of them';
  assert not private.can_see_photo_file(ph1), 'nor may it open the file';
  blocked := false;
  begin
    perform public.supplier_product_photos(s_a);
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'another supplier cannot list them';

  perform set_config('request.jwt.claims', json_build_object('sub', u_adm, 'role', 'authenticated')::text, true);
  select count(*) into n from public.master_photos where code in ('SPCHK-1', 'SPCHK-X');
  assert n = 2, 'VRPRIME sees every photo';
  blocked := false;
  begin
    perform public.master_photo_set('SPCHK-1', ph2);
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'a photo whose file never arrived is refused';
  blocked := false;
  begin
    perform public.master_photo_set('SPCHK-NO-SUCH', ph1);
  exception when invalid_parameter_value then blocked := true;
  end;
  assert blocked, 'an unknown master SKU is refused';
  reset role;
  -- With the new file there (where SQL may add one: the live database may not let it), a new photo replaces the old
  -- one and hands back the old file for the app to remove.
  begin
    insert into storage.objects (bucket_id, name) values ('product-photos', ph2);
    stored := true;
  exception when others then
    stored := false;
  end;
  set local role authenticated;
  if stored then
    assert public.master_photo_set('SPCHK-1', ph2) = ph1, 'replacing a photo hands back the old file';
    assert (select f.path from public.master_photos f where f.code = 'SPCHK-1') = ph2, 'the new photo is in place';
  end if;
  assert public.master_photo_remove('SPCHK-X') is not null, 'removing a photo hands back its file';
  assert not exists (select 1 from public.master_photos where code = 'SPCHK-X'), 'and the photo is gone';
  reset role;

  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  blocked := false;
  begin
    select count(*) into n from public.master_photos;
    blocked := n = 0;
  exception when insufficient_privilege then blocked := true;
  end;
  assert blocked, 'a signed-out visitor sees no photos';
  reset role;

  -- =====================================================================================
  -- 9. A deactivated supplier login, a deactivated supplier, a signed-out visitor
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
