-- The day book: what came into the supplier's godown and what went out to VRPRIME, day by day, for the supplier's owner
-- and VRPRIME (the user, 2026-11-26: "can we give date filter to admin and rajesh so we can see what exactly and when all
-- items are coming in warehouse and inbounded or dispatched by Mahesh ... this is going to be for Rajesh and me owner
-- and supplier only"). It only reads. The warehouse person is refused.
--
--   supplier_day_book(p_supplier, p_from, p_to)   between two days in India, both included, at most 366 days apart:
--     in      each goods in: when, by whom, the supply, how much, what it weighed, the bill's photo and note
--     loaded  cartons scanned onto a dispatch, per day, dispatch, product and person: how many, their pieces, and the
--             first and last scan
--     sent    each dispatch closed (sent to VRPRIME) that day: its cartons and pieces, how many have reached VRPRIME,
--             and who closed it
--   One jsonb value, so a long range is never cut short by the API's row limit.

create function public.supplier_day_book(p_supplier uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  perform private.require_supplier_editor(p_supplier);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    raise exception 'pick a first day on or before the last day, at most a year apart' using errcode = '22023';
  end if;
  v_start := p_from::timestamp at time zone 'Asia/Kolkata';
  v_end := (p_to + 1)::timestamp at time zone 'Asia/Kolkata';
  return jsonb_build_object(
    'in', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'day', m.moved_on, 'at', m.created_at, 'who', coalesce(pr.name, ''),
                                          'item_id', m.item_id, 'qty', m.qty, 'kg', m.weight_kg, 'photo_path', m.photo_path,
                                          'note', m.note)
                       order by m.moved_on desc, m.created_at desc, m.id desc)
      from public.supplier_item_moves m
      left join public.profiles pr on pr.id = m.created_by
      where m.supplier_id = p_supplier and m.reason = 'received' and m.moved_on between p_from and p_to
    ), '[]'::jsonb),
    'loaded', coalesce((
      select jsonb_agg(jsonb_build_object('day', l.day, 'first_at', l.first_at, 'last_at', l.last_at, 'who', l.who,
                                          'dispatch_id', l.dispatch_id, 'number', l.number, 'status', l.status,
                                          'product_id', l.product_id, 'cartons', l.cartons, 'units', l.units)
                       order by l.day desc, l.last_at desc, l.number desc)
      from (
        select (c.loaded_at at time zone 'Asia/Kolkata')::date as day, min(c.loaded_at) as first_at, max(c.loaded_at) as last_at,
               coalesce(pr.name, '') as who, c.dispatch_id, d.number, d.status, c.product_id,
               count(*)::integer as cartons, sum(c.units)::bigint as units
        from public.supplier_cartons c
        join public.supplier_dispatches d on d.id = c.dispatch_id
        left join public.profiles pr on pr.id = c.loaded_by
        where c.supplier_id = p_supplier and c.status = 'loaded' and c.loaded_at >= v_start and c.loaded_at < v_end
        group by 1, c.loaded_by, pr.name, c.dispatch_id, d.number, d.status, c.product_id
      ) l
    ), '[]'::jsonb),
    'sent', coalesce((
      select jsonb_agg(jsonb_build_object('day', (d.closed_at at time zone 'Asia/Kolkata')::date, 'at', d.closed_at,
                                          'who', coalesce(pr.name, ''), 'dispatch_id', d.id, 'number', d.number, 'status', d.status,
                                          'cartons', k.cartons, 'units', k.units, 'arrived', k.arrived)
                       order by d.closed_at desc, d.number desc)
      from public.supplier_dispatches d
      left join public.profiles pr on pr.id = d.closed_by
      cross join lateral (
        select count(*)::integer as cartons, coalesce(sum(c.units), 0)::bigint as units,
               (count(*) filter (where c.inbound_status = 'received'))::integer as arrived
        from public.supplier_cartons c
        where c.dispatch_id = d.id and c.status = 'loaded'
      ) k
      where d.supplier_id = p_supplier and d.status in ('closed', 'received') and d.closed_at >= v_start and d.closed_at < v_end
    ), '[]'::jsonb)
  );
end $$;

revoke all on function public.supplier_day_book(uuid, date, date) from public, anon;
grant execute on function public.supplier_day_book(uuid, date, date) to authenticated, service_role;
