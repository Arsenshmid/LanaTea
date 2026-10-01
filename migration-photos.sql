-- =====================================================================
-- Фото к новостям и событиям. Выполнить ОДИН РАЗ после schema.sql
-- и news-events.sql (повторный запуск безопасен).
-- =====================================================================

alter table public.news_events
  add column if not exists image_url text;

-- Публичный бакет для фотографий новостей
insert into storage.buckets (id, name, public)
values ('news-images', 'news-images', true)
on conflict (id) do nothing;

drop policy if exists "news_images_read" on storage.objects;
create policy "news_images_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'news-images');

drop policy if exists "news_images_admin_insert" on storage.objects;
create policy "news_images_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'news-images' and public.is_admin());

drop policy if exists "news_images_admin_update" on storage.objects;
create policy "news_images_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'news-images' and public.is_admin());

drop policy if exists "news_images_admin_delete" on storage.objects;
create policy "news_images_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'news-images' and public.is_admin());
