-- Product photos: one picture per VRPRIME master SKU, uploaded by VRPRIME's owner or admin, so the supplier's team sees
-- exactly which product is meant on every send plan, dispatch and product list.
--
--   public.master_photos   master SKU code -> its picture, a file "<uuid>.jpg" in the private bucket 'product-photos'
--
-- Keyed by the code (the inventory software's name for the product), not by the copied master_products row, so a photo
-- stays when the stock copy is read again. A new picture is always a new file, so its address never changes meaning.
-- Who sees a photo: VRPRIME's owner and admin, and the logins of a supplier with a product linked to that master SKU.
-- Who changes them: VRPRIME's owner and admin only. Nothing in the inventory software is touched.

create table public.master_photos (
  code text primary key check (length(code) between 1 and 200),
  path text not null unique check (path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index master_photos_updated_by_idx on public.master_photos (updated_by);

-- May the signed-in person see this master SKU's photo?
create function private.can_see_master_photo(p_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_staff(), false) or exists (
    select 1 from public.supplier_products sp
    join public.master_products m on m.id = sp.master_id
    where sp.supplier_id = private.my_supplier() and m.code = p_code)
$$;

-- The same, for a file in the bucket.
create function private.can_see_photo_file(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.master_photos f where f.path = p_name and private.can_see_master_photo(f.code))
$$;

alter table public.master_photos enable row level security;
revoke all on public.master_photos from public, anon, authenticated;
grant select on public.master_photos to authenticated;
grant all on public.master_photos to service_role;
create policy master_photos_select on public.master_photos for select to authenticated
  using ((select private.can_see_master_photo(code)));

-- ---------------------------------------------------------------------------
-- The bucket: private, JPEG only (the app turns every picture into one), 2 MB at most.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

create policy product_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'product-photos' and (private.is_staff() or private.can_see_photo_file(name)));
create policy product_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'product-photos' and private.is_staff()
              and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$');
create policy product_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-photos' and private.is_staff());

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Sets or replaces a master SKU's photo; VRPRIME's owner and admin. The file is uploaded first. Returns the file it
-- replaced (for the app to remove), or null.
create function public.master_photo_set(p_code text, p_path text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_old text;
begin
  perform private.require_staff();
  if p_code is null or not exists (select 1 from public.master_products m where m.code = p_code) then
    raise exception 'that master SKU was not found' using errcode = '22023';
  end if;
  if p_path is null or p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'product-photos' and o.name = p_path) then
    raise exception 'the photo did not arrive: upload it again' using errcode = '22023';
  end if;
  select f.path into v_old from public.master_photos f where f.code = p_code for update;
  insert into public.master_photos (code, path, updated_by, updated_at)
  values (p_code, p_path, (select auth.uid()), now())
  on conflict (code) do update set path = excluded.path, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return case when v_old is distinct from p_path then v_old end;
end $$;

-- Takes a master SKU's photo away; VRPRIME's owner and admin. Returns its file, for the app to remove.
create function public.master_photo_remove(p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_old text;
begin
  perform private.require_staff();
  delete from public.master_photos where code = p_code returning path into v_old;
  return v_old;
end $$;

-- A supplier's products that have a photo, with the photo's file. The supplier's logins and VRPRIME.
create function public.supplier_product_photos(p_supplier uuid)
returns table (product_id uuid, code text, path text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_see_supplier(p_supplier) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select sp.id, f.code, f.path
    from public.supplier_products sp
    join public.master_products m on m.id = sp.master_id
    join public.master_photos f on f.code = m.code
    where sp.supplier_id = p_supplier;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function private.can_see_master_photo(text), private.can_see_photo_file(text) from public, anon;
-- The read rules above run these as the person reading.
grant execute on function private.can_see_master_photo(text), private.can_see_photo_file(text) to authenticated, service_role;

revoke all on function public.master_photo_set(text, text), public.master_photo_remove(text), public.supplier_product_photos(uuid) from public, anon;
grant execute on function public.master_photo_set(text, text), public.master_photo_remove(text), public.supplier_product_photos(uuid) to authenticated, service_role;
