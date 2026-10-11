-- =====================================================================
-- Adolfo Training · almacenamiento privado de fotografías de evolución
--
-- * Bucket privado: nunca se generan URLs públicas.
-- * Ruta obligatoria: <user_id>/<entry_id>/<archivo>
-- * Solo el propietario puede leer, subir, sustituir o borrar sus archivos.
--   La app accede mediante URLs firmadas de corta duración.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'progress-photos',
  'progress-photos',
  false,
  26214400, -- 25 MB por archivo
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  drop policy if exists "fotos_propietario_select" on storage.objects;
  drop policy if exists "fotos_propietario_insert" on storage.objects;
  drop policy if exists "fotos_propietario_update" on storage.objects;
  drop policy if exists "fotos_propietario_delete" on storage.objects;

  create policy "fotos_propietario_select" on storage.objects
    for select to authenticated
    using (bucket_id = 'progress-photos'
           and (storage.foldername(name))[1] = (select auth.uid())::text);

  create policy "fotos_propietario_insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'progress-photos'
                and (storage.foldername(name))[1] = (select auth.uid())::text);

  create policy "fotos_propietario_update" on storage.objects
    for update to authenticated
    using (bucket_id = 'progress-photos'
           and (storage.foldername(name))[1] = (select auth.uid())::text)
    with check (bucket_id = 'progress-photos'
                and (storage.foldername(name))[1] = (select auth.uid())::text);

  create policy "fotos_propietario_delete" on storage.objects
    for delete to authenticated
    using (bucket_id = 'progress-photos'
           and (storage.foldername(name))[1] = (select auth.uid())::text);
end;
$$;
