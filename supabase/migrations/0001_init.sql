-- Trip Split: схема, RLS и RPC.
-- Деньги хранятся целыми числами в сотых долях валюты (сатанги / тиыны / центы).
-- Выполнить целиком в Supabase → SQL Editor.

create extension if not exists pgcrypto;

create type public.pay_method as enum ('card', 'cash');
create type public.split_mode as enum ('equal', 'custom');

-- ───────────────────────── tables ─────────────────────────

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 40),
  avatar_color text not null default '#0d9488',
  created_at   timestamptz not null default now()
);

create table public.trips (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 80),
  base_currency text not null default 'THB' check (base_currency ~ '^[A-Z]{3}$'),
  invite_code   text not null unique default encode(gen_random_bytes(5), 'hex'),
  created_by    uuid not null default auth.uid() references public.profiles (id),
  created_at    timestamptz not null default now()
);

create table public.trip_members (
  trip_id   uuid not null references public.trips (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create index on public.trip_members (user_id);

create table public.expenses (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  paid_by     uuid not null references public.profiles (id),
  title       text not null check (char_length(title) between 1 and 120),
  note        text check (char_length(note) <= 500),
  amount      bigint not null check (amount between 1 and 100000000000),
  currency    text not null check (currency ~ '^[A-Z]{3}$'),
  rate        numeric(24, 10) not null check (rate > 0),
  amount_base bigint not null check (amount_base between 1 and 10000000000000),
  method      public.pay_method not null default 'card',
  bank        text check (bank ~ '^[a-z0-9_]{2,20}$'),
  split_mode  public.split_mode not null default 'equal',
  spent_at    timestamptz not null default now(),
  created_by  uuid not null default auth.uid() references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid not null default auth.uid() references public.profiles (id),  -- кто менял последним (для уведомлений)
  check ((method = 'card') = (bank is not null))
);
create index on public.expenses (trip_id, spent_at desc);

create table public.expense_shares (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  user_id    uuid not null references public.profiles (id),
  share_base bigint not null check (share_base >= 0),
  primary key (expense_id, user_id)
);

create table public.settlements (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  from_user   uuid not null references public.profiles (id),
  to_user     uuid not null references public.profiles (id),
  amount_base bigint not null check (amount_base between 1 and 10000000000000),
  method      public.pay_method not null default 'cash',
  bank        text check (bank ~ '^[a-z0-9_]{2,20}$'),
  created_by  uuid not null default auth.uid() references public.profiles (id),
  created_at  timestamptz not null default now(),
  check (from_user <> to_user),
  check ((method = 'card') = (bank is not null))
);
create index on public.settlements (trip_id);

-- личные операции с наличными: «привёз с собой» и «обменял валюту»
-- (расходы наличными и возвраты долгов наличными списываются из кошелька автоматически)
create type public.cash_kind as enum ('deposit', 'exchange');

create table public.cash_ops (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.trips (id) on delete cascade,
  user_id       uuid not null default auth.uid() references public.profiles (id),
  kind          public.cash_kind not null,
  from_amount   bigint check (from_amount between 1 and 100000000000),
  from_currency text check (from_currency ~ '^[A-Z]{3}$'),
  to_amount     bigint not null check (to_amount between 1 and 100000000000),
  to_currency   text not null check (to_currency ~ '^[A-Z]{3}$'),
  note          text check (char_length(note) <= 200),
  happened_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  check (
    (kind = 'deposit'  and from_amount is null and from_currency is null) or
    (kind = 'exchange' and from_amount is not null and from_currency is not null and from_currency <> to_currency)
  )
);
create index on public.cash_ops (trip_id, user_id);

-- ───────────────────────── helpers ─────────────────────────

create or replace function public.is_trip_member(p_trip uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from trip_members where trip_id = p_trip and user_id = auth.uid());
$$;

create or replace function public.shares_trip_with(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from trip_members a join trip_members b on a.trip_id = b.trip_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

-- профиль создаётся сразу при регистрации
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  colors text[] := array['#0d9488','#2563eb','#db2777','#ea580c','#7c3aed','#16a34a','#ca8a04','#dc2626'];
begin
  insert into profiles (id, name, avatar_color)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)), 40),
    colors[1 + floor(random() * array_length(colors, 1))::int]
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- создатель поездки автоматически становится участником
create or replace function public.handle_new_trip()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into trip_members (trip_id, user_id) values (new.id, new.created_by);
  return new;
end $$;

create trigger on_trip_created after insert on public.trips
  for each row execute function public.handle_new_trip();

-- ───────────────────────── RLS ─────────────────────────

alter table public.profiles       enable row level security;
alter table public.trips          enable row level security;
alter table public.trip_members   enable row level security;
alter table public.expenses       enable row level security;
alter table public.expense_shares enable row level security;
alter table public.settlements    enable row level security;
alter table public.cash_ops       enable row level security;

create policy "profiles read"   on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_trip_with(id));
create policy "profiles update" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "trips read"   on public.trips for select to authenticated
  using (created_by = auth.uid() or public.is_trip_member(id));
create policy "trips insert" on public.trips for insert to authenticated with check (created_by = auth.uid());
create policy "trips update" on public.trips for update to authenticated
  using (public.is_trip_member(id)) with check (public.is_trip_member(id));
create policy "trips delete" on public.trips for delete to authenticated using (created_by = auth.uid());

create policy "members read"  on public.trip_members for select to authenticated using (public.is_trip_member(trip_id));
-- выход из поездки — только через leave_trip() (с проверкой, что человек не участвует в расчётах)

create policy "expenses read"   on public.expenses for select to authenticated using (public.is_trip_member(trip_id));
create policy "expenses delete" on public.expenses for delete to authenticated using (public.is_trip_member(trip_id));
-- вставка и изменение расходов идут только через save_expense()

create policy "shares read" on public.expense_shares for select to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id and public.is_trip_member(e.trip_id)));

create policy "settlements read"   on public.settlements for select to authenticated using (public.is_trip_member(trip_id));
create policy "settlements insert" on public.settlements for insert to authenticated
  with check (
    public.is_trip_member(trip_id) and created_by = auth.uid()
    and exists (select 1 from public.trip_members m where m.trip_id = settlements.trip_id and m.user_id = from_user)
    and exists (select 1 from public.trip_members m where m.trip_id = settlements.trip_id and m.user_id = to_user)
  );
create policy "settlements delete" on public.settlements for delete to authenticated using (public.is_trip_member(trip_id));

create policy "cash read"   on public.cash_ops for select to authenticated using (public.is_trip_member(trip_id));
create policy "cash insert" on public.cash_ops for insert to authenticated
  with check (user_id = auth.uid() and public.is_trip_member(trip_id));
create policy "cash delete" on public.cash_ops for delete to authenticated using (user_id = auth.uid());

-- права выдаём явно: в новых проектах Supabase таблицы больше не открываются для API автоматически.
-- Что именно можно делать, всё равно решают RLS-политики выше; anon (без входа) к данным доступа не имеет.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;

-- менять можно только безопасные колонки (не invite_code / created_by / id)
revoke update on public.trips, public.profiles, public.cash_ops from authenticated, anon;
grant update (name, base_currency) on public.trips to authenticated;
grant update (name) on public.profiles to authenticated;

-- валюту итогов нельзя менять, когда уже есть расходы или возвраты (суммы посчитаны в старой валюте)
create or replace function public.guard_base_currency()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.base_currency <> old.base_currency
     and (exists (select 1 from expenses where trip_id = new.id) or exists (select 1 from settlements where trip_id = new.id)) then
    raise exception 'Валюту итогов нельзя менять, когда уже есть расходы';
  end if;
  return new;
end $$;

create trigger trips_guard_base_currency before update on public.trips
  for each row execute function public.guard_base_currency();

-- ───────────────────────── RPC ─────────────────────────

create or replace function public.join_trip(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_trip uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select id into v_trip from trips where invite_code = lower(trim(p_code));
  if v_trip is null then raise exception 'Приглашение не найдено'; end if;
  insert into trip_members (trip_id, user_id) values (v_trip, auth.uid()) on conflict do nothing;
  return v_trip;
end $$;

-- создать (p_id = null) или изменить расход вместе с долями, атомарно
create or replace function public.save_expense(
  p_id uuid, p_trip_id uuid, p_paid_by uuid, p_title text, p_note text,
  p_amount bigint, p_currency text, p_rate numeric, p_amount_base bigint,
  p_method public.pay_method, p_bank text, p_split_mode public.split_mode, p_spent_at timestamptz,
  p_shares jsonb,  -- [{"user_id": "...", "share_base": 123}, ...]
  p_create boolean default false  -- новый расход с id, выданным на телефоне (офлайн-очередь)
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id  uuid;
  v_sum bigint;
  v_bad int;
begin
  if not is_trip_member(p_trip_id) then raise exception 'Нет доступа к поездке'; end if;
  if not exists (select 1 from trip_members where trip_id = p_trip_id and user_id = p_paid_by) then
    raise exception 'Плательщик не участник поездки';
  end if;
  if jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then
    raise exception 'Не выбрано, за кого платили';
  end if;

  select coalesce(sum((s ->> 'share_base')::bigint), 0),
         count(*) filter (where not exists (
           select 1 from trip_members m where m.trip_id = p_trip_id and m.user_id = (s ->> 'user_id')::uuid))
    into v_sum, v_bad
    from jsonb_array_elements(p_shares) s;

  if v_bad > 0 then raise exception 'В долях есть не участник поездки'; end if;
  if v_sum <> p_amount_base then raise exception 'Доли (%) не сходятся с суммой (%)', v_sum, p_amount_base; end if;

  -- новый: без id, или с id от клиента, которого ещё нет. Повтор той же отправки обновит уже созданный — без дублей
  if p_id is null or (p_create and not exists (select 1 from expenses where id = p_id)) then
    insert into expenses (id, trip_id, paid_by, title, note, amount, currency, rate, amount_base,
                          method, bank, split_mode, spent_at)
    values (coalesce(p_id, gen_random_uuid()), p_trip_id, p_paid_by, trim(p_title), nullif(trim(p_note), ''), p_amount, p_currency,
            p_rate, p_amount_base, p_method, case when p_method = 'card' then p_bank end, p_split_mode, p_spent_at)
    returning id into v_id;
  else
    update expenses set
      paid_by = p_paid_by, title = trim(p_title), note = nullif(trim(p_note), ''),
      amount = p_amount, currency = p_currency, rate = p_rate, amount_base = p_amount_base,
      method = p_method, bank = case when p_method = 'card' then p_bank end, split_mode = p_split_mode, spent_at = p_spent_at,
      updated_at = now(), updated_by = auth.uid()
    where id = p_id and trip_id = p_trip_id
    returning id into v_id;
    if v_id is null then raise exception 'Расход не найден'; end if;
    delete from expense_shares where expense_id = v_id;
  end if;

  insert into expense_shares (expense_id, user_id, share_base)
  select v_id, (s ->> 'user_id')::uuid, (s ->> 'share_base')::bigint
  from jsonb_array_elements(p_shares) s;

  return v_id;
end $$;

-- выйти можно, только если ты не платил, не участвовал в долях и в возвратах — иначе сломаются итоги у остальных
create or replace function public.leave_trip(p_trip uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_trip_member(p_trip) then raise exception 'Ты не участник поездки'; end if;
  if exists (select 1 from expenses where trip_id = p_trip and paid_by = auth.uid())
     or exists (select 1 from expense_shares s join expenses e on e.id = s.expense_id
                where e.trip_id = p_trip and s.user_id = auth.uid())
     or exists (select 1 from settlements where trip_id = p_trip and auth.uid() in (from_user, to_user)) then
    raise exception 'Нельзя выйти: ты уже есть в расходах этой поездки';
  end if;
  delete from cash_ops where trip_id = p_trip and user_id = auth.uid();
  delete from trip_members where trip_id = p_trip and user_id = auth.uid();
end $$;

revoke execute on function public.leave_trip(uuid) from anon;
revoke execute on function public.join_trip(text) from anon;
revoke execute on function public.save_expense(uuid, uuid, uuid, text, text, bigint, text, numeric, bigint,
  public.pay_method, text, public.split_mode, timestamptz, jsonb, boolean) from anon;

-- ───────────────────────── realtime ─────────────────────────

alter publication supabase_realtime add table public.expenses, public.settlements, public.trip_members, public.cash_ops;
