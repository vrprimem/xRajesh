-- Master SKU search: so a supplier's owner can link their products to VRPRIME master SKUs by name, without knowing
-- the codes. Typing "cleaner" lists every master SKU with "cleaner" in its name or code; every word typed must appear
-- (in any order), so "kitchen clean" finds "Kitchen Cleaner Spray 500ml". At least 2 letters; at most 25 matches, the
-- closest first (name starts with the first word, then shorter names).
--
-- Who: VRPRIME owner and admin, and a supplier's owner login (who adds and edits its products). Not the warehouse
-- person. It answers with codes and names only, never stock; supplier logins still cannot read the master SKU table
-- itself. Master SKUs are the inventory software's products, copied in by the stock sync; nothing here changes them.

create function public.master_sku_search(p_query text) returns table (code text, name text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_words text[];
begin
  if not (coalesce(private.is_staff(), false) or private.supplier_role() is not distinct from 'supplier_owner') then
    raise exception 'Only VRPRIME and a supplier''s owner can search master SKUs' using errcode = '42501';
  end if;
  -- Up to 6 words of the first 60 characters; matched as plain text (no wildcards).
  v_words := array(
    select w from regexp_split_to_table(lower(left(btrim(coalesce(p_query, '')), 60)), '\s+') w where w <> '' limit 6
  );
  if coalesce(length(array_to_string(v_words, '')), 0) < 2 then
    return;
  end if;
  return query
    select m.code, m.name
    from public.master_products m
    where (select bool_and(strpos(lower(m.name || ' ' || m.code), w) > 0) from unnest(v_words) w)
    order by left(lower(m.name), length(v_words[1])) = v_words[1] desc,
             left(lower(m.code), length(v_words[1])) = v_words[1] desc,
             length(m.name),
             m.name
    limit 25;
end $$;

revoke all on function public.master_sku_search(text) from public, anon;
grant execute on function public.master_sku_search(text) to authenticated;
