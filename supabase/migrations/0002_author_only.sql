-- Чужие записи не трогаем: расход меняет и удаляет только тот, кто его внёс,
-- отметку о возврате удаляет только тот, кто её поставил.

drop policy if exists "expenses delete" on public.expenses;
create policy "expenses delete" on public.expenses for delete to authenticated using (created_by = auth.uid());

drop policy if exists "settlements delete" on public.settlements;
create policy "settlements delete" on public.settlements for delete to authenticated using (created_by = auth.uid());

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
    if exists (select 1 from expenses where id = p_id and trip_id = p_trip_id and created_by <> auth.uid()) then
      raise exception 'Изменить расход может только автор';
    end if;
    update expenses set
      paid_by = p_paid_by, title = trim(p_title), note = nullif(trim(p_note), ''),
      amount = p_amount, currency = p_currency, rate = p_rate, amount_base = p_amount_base,
      method = p_method, bank = case when p_method = 'card' then p_bank end, split_mode = p_split_mode, spent_at = p_spent_at,
      updated_at = now(), updated_by = auth.uid()
    where id = p_id and trip_id = p_trip_id and created_by = auth.uid()
    returning id into v_id;
    if v_id is null then raise exception 'Расход не найден'; end if;
    delete from expense_shares where expense_id = v_id;
  end if;

  insert into expense_shares (expense_id, user_id, share_base)
  select v_id, (s ->> 'user_id')::uuid, (s ->> 'share_base')::bigint
  from jsonb_array_elements(p_shares) s;

  return v_id;
end $$;
