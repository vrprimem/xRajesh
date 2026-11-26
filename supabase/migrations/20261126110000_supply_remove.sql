-- Removing a supply for good: the supplier's owner or VRPRIME (the user, 2026-11-26: "give rajesh an option to remove
-- product from supplies"). The warehouse person cannot.
--
--   supplier_item_delete  its stock changes (goods in, counts, what production took) and its lines in the product
--                         recipes go with it (their foreign keys cascade). Production entries stay as they are; what is
--                         made from now on no longer takes it. A supply with purchases is not removed, so the money stays
--                         right: switching "In use" off hides it instead. Returns the photo files that went with it (its
--                         own photo, and the bills of its goods in that nothing else shows), for the app to remove from
--                         the supplier-photos bucket.

create function public.supplier_item_delete(p_item uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  v_supplier uuid;
  v_name text;
  v_photo text;
  v_files text[];
begin
  select i.supplier_id, i.name, i.photo_path into v_supplier, v_name, v_photo
  from public.supplier_items i where i.id = p_item for update;
  if v_supplier is null then
    raise exception 'this supply is no longer there' using errcode = '22023';
  end if;
  perform private.require_supplier_editor(v_supplier);
  if exists (select 1 from public.supplier_purchases p where p.item_id = p_item) then
    raise exception '% has purchases in the money records, so it cannot be removed. To hide it, untick "In use" in Edit', v_name
      using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct m.photo_path), '{}') into v_files
  from public.supplier_item_moves m
  where m.item_id = p_item and m.photo_path is not null
    and not exists (select 1 from public.supplier_item_moves o where o.photo_path = m.photo_path and o.item_id <> p_item);
  if v_photo is not null and not exists (select 1 from public.supplier_items o where o.photo_path = v_photo and o.id <> p_item) then
    v_files := array_prepend(v_photo, v_files);
  end if;
  delete from public.supplier_items where id = p_item;
  return v_files;
end $$;

revoke all on function public.supplier_item_delete(uuid) from public, anon;
grant execute on function public.supplier_item_delete(uuid) to authenticated, service_role;
