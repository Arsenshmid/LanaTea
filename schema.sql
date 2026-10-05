-- =====================================================================
-- Чайный дом Саргыланы: схема для Supabase (Postgres)
-- Запускать целиком в Supabase -> SQL Editor -> New query -> Run
-- =====================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- 1. Профили (расширение встроенной таблицы пользователей auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '',
  phone      text not null default '',
  email      text not null default '',
  privacy_policy_version text not null,
  privacy_consented_at timestamptz not null,
  role       text not null default 'client' check (role in ('client', 'admin')),
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql security definer stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- Профиль создаётся автоматически при регистрации.
-- Имя и телефон передаём в options.data при signUp.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.raw_user_meta_data->>'privacy_policy_version' is distinct from '2026-10-01' then
    raise exception 'Необходимо принять действующую политику обработки данных';
  end if;

  insert into public.profiles (id, full_name, phone, email, privacy_policy_version, privacy_consented_at)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    coalesce(new.email, ''),
    new.raw_user_meta_data->>'privacy_policy_version',
    now()
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 2. Настройки (одна строка): цены редактирует админ
-- ---------------------------------------------------------------------
create table public.settings (
  id                    int primary key default 1 check (id = 1),
  price_individual      int not null default 2500,
  price_group_per_guest int not null default 1500
);
insert into public.settings default values;

-- ---------------------------------------------------------------------
-- 3. Чайная карта (Саргылана сможет менять сама через админку)
-- ---------------------------------------------------------------------
create table public.teas (
  id          serial primary key,
  slug        text unique not null,
  name        text not null,
  description text not null default '',
  sort_order  int not null default 0,
  is_active   boolean not null default true
);

insert into public.teas (slug, name, sort_order) values
  ('white',       'Белый',            1),
  ('green',       'Зелёный',          2),
  ('light-oolong','Светлый улун',     3),
  ('dark-oolong', 'Тёмный улун',      4),
  ('red',         'Красный',          5),
  ('puer',        'Пуэр',             6),
  ('gaba',        'ГАБА',             7),
  ('yakut',       'Якутский чай с молоком и травами', 8);

-- ---------------------------------------------------------------------
-- 4. Новости и события чайного дома
-- ---------------------------------------------------------------------
create table public.news_events (
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

create index news_events_public_date_idx on public.news_events (event_date)
  where is_published;

-- ---------------------------------------------------------------------
-- 5. Записи
--    Групповая = одна компания занимает стол целиком, поэтому
--    любые две активные записи не могут пересекаться по времени.
-- ---------------------------------------------------------------------
create table public.bookings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete restrict,
  booking_date date not null,
  time_from    time not null,
  time_to      time not null,
  format       text not null check (format in ('individual', 'group')),
  guests       int  not null,
  tea_id       int references public.teas(id),   -- null = «пусть Саргылана выберет»
  comment      text not null default '',
  price        int  not null default 0,          -- считается триггером, фиксируется на момент записи
  status       text not null default 'pending'
               check (status in ('pending', 'confirmed', 'cancelled')),
  created_at   timestamptz not null default now(),

  constraint valid_time   check (time_to > time_from
                                 and time_to - time_from in (interval '90 minutes', interval '120 minutes')),
  -- Часы работы 10:00-21:00. Если изменятся, пересоздайте это ограничение.
  constraint valid_hours  check (time_from >= '10:00' and time_to <= '21:00'),
  constraint valid_guests check (
       (format = 'individual' and guests between 1 and 2)
    or (format = 'group'      and guests between 2 and 25)
  ),
  -- Главная защита от двойной записи: работает даже при одновременных заявках.
  -- Между церемониями остаётся 30 минут на подготовку стола.
  -- Отменённые записи время не занимают.
  constraint no_overlap exclude using gist (
    tsrange(booking_date + time_from, booking_date + time_to + interval '30 minutes') with &&
  ) where (status <> 'cancelled')
);

create index bookings_user_idx on public.bookings (user_id);
create index bookings_date_idx on public.bookings (booking_date);

-- Цена считается на сервере, чтобы клиент не мог её подменить.
-- Дата проверяется по якутскому времени.
create or replace function public.bookings_before_insert()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.settings;
begin
  select * into s from public.settings where id = 1;

  new.price := case
    when new.format = 'individual' then s.price_individual
    else s.price_group_per_guest * new.guests
  end;

  if new.booking_date < (now() at time zone 'Asia/Yakutsk')::date then
    raise exception 'Нельзя записаться на прошедшую дату';
  end if;

  return new;
end;
$$;

create trigger bookings_before_insert
  before insert on public.bookings
  for each row execute function public.bookings_before_insert();

-- Занятые интервалы дня БЕЗ личных данных: чтобы показать клиентам,
-- какие слоты недоступны, не раскрывая чужие записи.
create or replace function public.busy_slots(day date)
returns table (slot_from time, slot_to time)
language sql security definer stable
set search_path = ''
as $$
  select b.time_from as slot_from, b.time_to as slot_to
  from public.bookings b
  where b.booking_date = day and b.status <> 'cancelled'
  order by b.time_from;
$$;

grant execute on function public.busy_slots(date) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Права доступа (RLS)
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.teas     enable row level security;
alter table public.bookings enable row level security;
alter table public.news_events enable row level security;

-- Анонимным пользователям закрываем всё, кроме чтения чая и цен.
revoke all on public.profiles, public.bookings from anon;

-- profiles: видишь себя (админ видит всех); менять можно только имя и телефон,
-- поле role клиент изменить не может.
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

grant select, update on public.profiles to authenticated;
revoke update on public.profiles from authenticated;
grant  update (full_name, phone) on public.profiles to authenticated;

-- settings и teas: читают все, меняет только админ.
create policy settings_read on public.settings
  for select to anon, authenticated using (true);
create policy settings_admin on public.settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.settings to anon, authenticated;
grant insert, update, delete on public.settings to authenticated;

create policy teas_read on public.teas
  for select to anon, authenticated using (true);
create policy teas_admin on public.teas
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.teas to anon, authenticated;
grant insert, update, delete on public.teas to authenticated;
grant usage, select on sequence public.teas_id_seq to authenticated;

-- Посетители видят опубликованные материалы; админ также видит черновики.
create policy news_events_read on public.news_events
  for select to anon, authenticated
  using (public.is_admin() or (is_published and (event_date is null or event_date >= current_date)));
create policy news_events_admin on public.news_events
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select on public.news_events to anon, authenticated;
grant insert, update, delete on public.news_events to authenticated;

-- bookings:
--  * видишь только свои (админ видит все);
--  * создать можно только на себя и только со статусом pending;
--  * менять можно только статус: клиент может лишь отменить свою запись,
--    админ может поставить любой статус;
--  * удалять нельзя (история сохраняется, запись отменяется).
create policy bookings_select on public.bookings
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy bookings_insert on public.bookings
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');

create policy bookings_update on public.bookings
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (status = 'cancelled' or public.is_admin());

revoke update, delete on public.bookings from authenticated;
grant select, insert on public.bookings to authenticated;
grant  update (status) on public.bookings to authenticated;

-- ---------------------------------------------------------------------
-- 6. Сделать Саргылану администратором (выполнить ПОСЛЕ её регистрации на сайте)
-- ---------------------------------------------------------------------
-- update public.profiles set role = 'admin'
-- where id = (select id from auth.users where email = 'lana@example.com');