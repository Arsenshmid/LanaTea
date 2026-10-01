-- Run this after schema.sql. Safe to rerun when updating event RLS policies.
create table if not exists public.news_events (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null default 'event' check (kind in ('news', 'event')),
  title        text not null check (char_length(btrim(title)) between 3 and 140),
  description  text not null default '',
  event_date   date,
  event_time   time,
  is_published boolean not null default false,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists news_events_public_date_idx on public.news_events (event_date)
  where is_published;

alter table public.news_events enable row level security;

drop policy if exists news_events_read on public.news_events;
create policy news_events_read on public.news_events
  for select to anon, authenticated
  using (public.is_admin() or (is_published and (event_date is null or event_date >= current_date)));

drop policy if exists news_events_admin on public.news_events;
create policy news_events_admin on public.news_events
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select on public.news_events to anon, authenticated;
grant insert, update, delete on public.news_events to authenticated;
