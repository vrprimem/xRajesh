-- "Dispatch due": every morning at 9:30 India time, the supplier's owner and warehouse person are told about each open
-- dispatch (planned or loading) that is due tomorrow, due today or overdue, with how far its loading is. Once a day per
-- dispatch, however often the job runs.

alter table public.supplier_dispatches add column due_alerted_on date;

create function private.supplier_dispatch_due() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_count integer := 0;
  d record;
  u uuid;
  v_title text;
begin
  for d in
    select sd.id, sd.supplier_id, sd.number, sd.due_on,
           (select count(*) from public.supplier_cartons c where c.dispatch_id = sd.id and c.status = 'loaded') as loaded,
           (select coalesce(sum(l.cartons), 0) from public.supplier_dispatch_lines l where l.dispatch_id = sd.id) as planned
    from public.supplier_dispatches sd
    join public.suppliers s on s.id = sd.supplier_id and s.active
    where sd.status in ('planned', 'loading') and sd.due_on <= v_today + 1
      and sd.due_alerted_on is distinct from v_today
  loop
    update public.supplier_dispatches set due_alerted_on = v_today where id = d.id;
    v_title := case
      when d.due_on < v_today then 'Dispatch ' || d.number || ' is overdue (was due ' || to_char(d.due_on, 'FMDD Mon') || ')'
      when d.due_on = v_today then 'Dispatch ' || d.number || ' is due today'
      else 'Dispatch ' || d.number || ' is due tomorrow'
    end;
    for u in select id from public.profiles where active and role in ('supplier_owner', 'supplier_scanner') and supplier_id = d.supplier_id loop
      insert into public.notifications (user_id, kind, url, title, body)
      values (u, 'supplier_due', '/supplier/dispatches/' || d.id::text, v_title,
              d.loaded || ' of ' || d.planned || ' cartons scanned so far.');
    end loop;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

revoke all on function private.supplier_dispatch_due() from public, anon, authenticated;
grant execute on function private.supplier_dispatch_due() to service_role;

-- 04:00 UTC is 9:30 am in India.
select cron.schedule('supplier-dispatch-due', '0 4 * * *', 'select private.supplier_dispatch_due()');
