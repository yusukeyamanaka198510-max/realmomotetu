-- Phase 8: 物件購入・カード取得・リアルタイム動的ゴール選定・経済スケール変更(億円単位)

-- ===================== スキーマ追加 =====================

alter table events add column active_destination_station_id uuid references stations (id);
alter table events alter column default_destination_bonus_amount set default 100000000;
update events set default_destination_bonus_amount = 100000000;

alter table stations add column is_destination_candidate boolean not null default false;

create table station_properties (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references stations (id) on delete cascade,
  name text not null,
  price bigint not null,
  yield_amount bigint not null default 0,
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index station_properties_station_idx on station_properties (station_id);

create table team_property_purchases (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  property_id uuid not null references station_properties (id),
  price_paid bigint not null,
  yield_amount bigint not null,
  purchased_at timestamptz not null default now(),
  settled boolean not null default false,
  settled_at timestamptz,
  idempotency_key uuid not null unique
);
create index team_property_purchases_team_idx on team_property_purchases (team_id);

create table station_cards (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references stations (id) on delete cascade,
  name text not null,
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index station_cards_station_idx on station_cards (station_id);

create table team_cards (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  card_id uuid not null references station_cards (id),
  acquired_at timestamptz not null default now()
);
create index team_cards_team_idx on team_cards (team_id);

-- ===================== RLS =====================

alter table station_properties enable row level security;
alter table team_property_purchases enable row level security;
alter table station_cards enable row level security;
alter table team_cards enable row level security;

grant select, insert, update, delete on station_properties, station_cards to authenticated;
grant select on team_property_purchases, team_cards to authenticated;

create policy station_properties_select on station_properties for select
  using (exists (select 1 from stations s where s.id = station_properties.station_id and s.event_id = current_event_id()));
create policy station_properties_staff_write on station_properties for all to authenticated
  using (exists (select 1 from stations s where s.id = station_properties.station_id and s.event_id = auth_staff_event_id()))
  with check (exists (select 1 from stations s where s.id = station_properties.station_id and s.event_id = auth_staff_event_id()));

create policy station_cards_select on station_cards for select
  using (exists (select 1 from stations s where s.id = station_cards.station_id and s.event_id = current_event_id()));
create policy station_cards_staff_write on station_cards for all to authenticated
  using (exists (select 1 from stations s where s.id = station_cards.station_id and s.event_id = auth_staff_event_id()))
  with check (exists (select 1 from stations s where s.id = station_cards.station_id and s.event_id = auth_staff_event_id()));

create policy team_property_purchases_select on team_property_purchases for select
  using (team_id = auth_team_id() or exists (select 1 from teams t where t.id = team_property_purchases.team_id and t.event_id = auth_staff_event_id()));

create policy team_cards_select on team_cards for select
  using (team_id = auth_team_id() or exists (select 1 from teams t where t.id = team_cards.team_id and t.event_id = auth_staff_event_id()));

alter publication supabase_realtime add table team_property_purchases;
alter publication supabase_realtime add table team_cards;

-- ===================== 動的ゴール選定 =====================
-- 稼働中の全チームの「現在駅」「移動中/移動先確定済みの次駅」を除外し、
-- is_destination_candidate=trueの駅からランダムに1つ選ぶ。

create or replace function fn_pick_next_destination(p_event_id uuid, p_exclude_station_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_excluded uuid[];
  v_next uuid;
begin
  select array_agg(distinct x) into v_excluded from (
    select current_station_id as x from team_state where event_id = p_event_id and current_station_id is not null
    union
    select t.next_station_id as x from turns t
      join team_state ts on ts.team_id = t.team_id
      where ts.event_id = p_event_id and ts.current_turn_id = t.id and t.next_station_id is not null
  ) s;

  select id into v_next from stations
    where event_id = p_event_id and is_destination_candidate = true
      and id <> all (coalesce(v_excluded, array[]::uuid[]))
      and (p_exclude_station_id is null or id <> p_exclude_station_id)
    order by random() limit 1;

  return v_next;
end;
$$;

create or replace function fn_admin_set_active_destination(p_station_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  update events set active_destination_station_id = p_station_id where id = v_staff_event_id;
  insert into audit_log (event_id, staff_id, action_type, after_value)
    values (v_staff_event_id, auth.uid(), 'DESTINATION_SET', jsonb_build_object('station_id', p_station_id));
end;
$$;

create or replace function fn_admin_randomize_next_destination()
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_current uuid;
  v_next uuid;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  select active_destination_station_id into v_current from events where id = v_staff_event_id;
  v_next := fn_pick_next_destination(v_staff_event_id, v_current);
  if v_next is null then
    raise exception 'ゴール候補駅が足りません(is_destination_candidateの駅を増やしてください)';
  end if;
  update events set active_destination_station_id = v_next where id = v_staff_event_id;
  return v_next;
end;
$$;

-- ===================== fn_admin_start_event: 開始時に最初のゴールを自動選定 =====================

create or replace function fn_admin_start_event(p_time_limit_minutes int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_dest uuid;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;

  v_dest := fn_pick_next_destination(v_staff_event_id);

  update events
    set status = 'RUNNING', start_at = now(), time_limit_minutes = p_time_limit_minutes,
        end_at = now() + make_interval(mins => p_time_limit_minutes),
        active_destination_station_id = coalesce(active_destination_station_id, v_dest)
    where id = v_staff_event_id;

  insert into audit_log (event_id, staff_id, action_type, after_value)
    values (v_staff_event_id, auth.uid(), 'EVENT_START', jsonb_build_object('time_limit_minutes', p_time_limit_minutes, 'first_destination', v_dest));
end;
$$;

-- ===================== fn_review_arrival: 動的ゴール判定に変更 =====================

create or replace function fn_review_arrival(p_arrival_submission_id uuid, p_decision text, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_team_id uuid;
  v_station_id uuid;
  v_turn_id uuid;
  v_event_id uuid;
  v_bonus bigint;
  v_offered uuid[];
  v_next_dest uuid;
begin
  if v_staff_event_id is null then
    raise exception 'staff only';
  end if;
  if p_decision not in ('APPROVE', 'REJECT') then
    raise exception 'invalid decision';
  end if;

  select a.team_id, a.station_id, a.turn_id, t.event_id
    into v_team_id, v_station_id, v_turn_id, v_event_id
    from arrival_submissions a
    join teams t on t.id = a.team_id
    where a.id = p_arrival_submission_id;

  if v_event_id is null or v_event_id is distinct from v_staff_event_id then
    raise exception 'not found or not your event';
  end if;

  update review_queue
    set status = 'CLAIMED', claimed_by = auth.uid(), claimed_at = now()
    where event_id = v_event_id and team_id = v_team_id and type = 'ARRIVAL'
      and ref_id = p_arrival_submission_id and status = 'OPEN';
  if not found then
    raise exception 'already handled by another staff member';
  end if;

  perform 1 from team_state where team_id = v_team_id for update;

  if p_decision = 'REJECT' then
    update arrival_submissions
      set status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now(), review_reason = p_reason
      where id = p_arrival_submission_id;
    update team_state set state = 'ARRIVAL_SUBMISSION', version = version + 1 where team_id = v_team_id;
    update review_queue set status = 'RESOLVED'
      where event_id = v_event_id and team_id = v_team_id and type = 'ARRIVAL' and ref_id = p_arrival_submission_id;

    insert into audit_log (event_id, staff_id, team_id, action_type, before_value, reason)
      values (v_event_id, auth.uid(), v_team_id, 'ARRIVAL_REJECT',
        jsonb_build_object('arrival_submission_id', p_arrival_submission_id), p_reason);
    return;
  end if;

  -- APPROVE
  update arrival_submissions
    set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_arrival_submission_id;

  -- 動的ゴール判定: 現在のactive_destination_station_idと一致するか
  select active_destination_station_id, default_destination_bonus_amount
    into v_next_dest, v_bonus
    from events where id = v_event_id for update;

  if v_next_dest is not null and v_next_dest = v_station_id then
    insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
      values (v_event_id, v_team_id, v_bonus, 'DESTINATION_BONUS', gen_random_uuid(), '最終目的地到達ボーナス', auth.uid());
    update team_state set coin_balance_cache = coin_balance_cache + v_bonus where team_id = v_team_id;

    insert into destination_queue (event_id, station_id, sequence_order, bonus_coin_amount, status, cleared_by_team_id, cleared_at)
      values (
        v_event_id, v_station_id,
        coalesce((select max(sequence_order) from destination_queue where event_id = v_event_id), 0) + 1,
        v_bonus, 'CLEARED', v_team_id, now()
      );

    v_next_dest := fn_pick_next_destination(v_event_id, v_station_id);
    update events set active_destination_station_id = v_next_dest where id = v_event_id;

    insert into audit_log (event_id, staff_id, team_id, action_type, before_value, after_value)
      values (v_event_id, auth.uid(), v_team_id, 'DESTINATION_BONUS',
        jsonb_build_object('station_id', v_station_id), jsonb_build_object('bonus', v_bonus, 'next_destination', v_next_dest));
  end if;

  v_offered := fn_generate_offered_missions(v_team_id, v_station_id);
  insert into team_mission_attempts (team_id, turn_id, station_id, offered_mission_ids, attempt_number, status)
    values (v_team_id, v_turn_id, v_station_id, v_offered, 1, 'OFFERED');

  update team_state set state = 'MISSION_SELECTION', version = version + 1 where team_id = v_team_id;
  update review_queue set status = 'RESOLVED'
    where event_id = v_event_id and team_id = v_team_id and type = 'ARRIVAL' and ref_id = p_arrival_submission_id;

  insert into audit_log (event_id, staff_id, team_id, action_type, before_value)
    values (v_event_id, auth.uid(), v_team_id, 'ARRIVAL_APPROVE', jsonb_build_object('arrival_submission_id', p_arrival_submission_id));
end;
$$;

-- ===================== fn_review_mission: 現在駅更新バグ修正 + カード自動取得 + 物件購入ゲート =====================

create or replace function fn_review_mission(p_attempt_id uuid, p_decision text, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_team_id uuid;
  v_event_id uuid;
  v_mission_id uuid;
  v_station_id uuid;
  v_turn_id uuid;
  v_attempt_number int;
  v_difficulty mission_difficulty;
  v_success_reward int;
  v_failure_penalty int;
  v_mission_success_count int;
  v_bonus_interval int;
  v_bonus_multiplier numeric;
  v_amount bigint;
  v_ttype coin_transaction_type;
  v_new_attempt_id uuid;
  v_card_id uuid;
  v_has_properties boolean;
  v_next_state team_game_state;
begin
  if v_staff_event_id is null then
    raise exception 'staff only';
  end if;
  if p_decision not in ('SUCCESS', 'FAILURE') then
    raise exception 'invalid decision';
  end if;

  select a.team_id, t.event_id, a.selected_mission_id, a.station_id, a.turn_id, a.attempt_number
    into v_team_id, v_event_id, v_mission_id, v_station_id, v_turn_id, v_attempt_number
    from team_mission_attempts a
    join teams t on t.id = a.team_id
    where a.id = p_attempt_id;

  if v_event_id is null or v_event_id is distinct from v_staff_event_id then
    raise exception 'not found or not your event';
  end if;

  update review_queue
    set status = 'CLAIMED', claimed_by = auth.uid(), claimed_at = now()
    where event_id = v_event_id and team_id = v_team_id and type = 'MISSION'
      and ref_id = p_attempt_id and status = 'OPEN';
  if not found then
    raise exception 'already handled by another staff member';
  end if;

  perform 1 from team_state where team_id = v_team_id for update;

  select difficulty,
      coalesce(success_reward, case difficulty when 'EASY' then 10000000 when 'NORMAL' then 20000000 when 'HARD' then 30000000 end),
      coalesce(failure_penalty, case difficulty when 'EASY' then 5000000 when 'NORMAL' then 10000000 when 'HARD' then 15000000 end)
    into v_difficulty, v_success_reward, v_failure_penalty
    from station_missions where id = v_mission_id;

  update review_queue set status = 'RESOLVED'
    where event_id = v_event_id and team_id = v_team_id and type = 'MISSION' and ref_id = p_attempt_id;

  if p_decision = 'FAILURE' then
    update team_mission_attempts
      set status = 'FAILURE', reviewed_by = auth.uid(), reviewed_at = now()
      where id = p_attempt_id;

    insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, related_mission_attempt_id, related_turn_id, reason, created_by)
      values (v_event_id, v_team_id, -v_failure_penalty, 'MISSION_FAILURE', gen_random_uuid(), p_attempt_id, v_turn_id, p_reason, auth.uid());
    update team_state set coin_balance_cache = coin_balance_cache - v_failure_penalty where team_id = v_team_id;

    insert into team_mission_attempts (team_id, turn_id, station_id, offered_mission_ids, selected_mission_id, locked_at, attempt_number, status)
      values (v_team_id, v_turn_id, v_station_id, array[v_mission_id], v_mission_id, now(), v_attempt_number + 1, 'AWAITING_PHOTO')
      returning id into v_new_attempt_id;

    update team_state set state = 'MISSION_ACTIVE', version = version + 1 where team_id = v_team_id;

    insert into audit_log (event_id, staff_id, team_id, action_type, before_value, after_value, reason)
      values (v_event_id, auth.uid(), v_team_id, 'MISSION_FAILURE',
        jsonb_build_object('attempt_id', p_attempt_id),
        jsonb_build_object('penalty', v_failure_penalty, 'new_attempt_id', v_new_attempt_id), p_reason);
    return;
  end if;

  -- SUCCESS
  select mission_success_count into v_mission_success_count from team_state where team_id = v_team_id;
  select mission_bonus_interval, mission_bonus_multiplier into v_bonus_interval, v_bonus_multiplier
    from events where id = v_event_id;

  v_mission_success_count := v_mission_success_count + 1;

  if v_bonus_interval > 0 and v_mission_success_count % v_bonus_interval = 0 then
    v_amount := round(v_success_reward * v_bonus_multiplier);
    v_ttype := 'MISSION_5X_BONUS';
  else
    v_amount := v_success_reward;
    v_ttype := 'MISSION_SUCCESS';
  end if;

  update team_mission_attempts
    set status = 'SUCCESS', reviewed_by = auth.uid(), reviewed_at = now(), is_bonus_applied = (v_ttype = 'MISSION_5X_BONUS')
    where id = p_attempt_id;

  insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, related_mission_attempt_id, related_turn_id, reason, created_by)
    values (v_event_id, v_team_id, v_amount, v_ttype, gen_random_uuid(), p_attempt_id, v_turn_id, p_reason, auth.uid());

  -- カード自動取得(その駅にアクティブなカードがあればランダムに1枚)
  select id into v_card_id from station_cards where station_id = v_station_id and is_active order by random() limit 1;
  if v_card_id is not null then
    insert into team_cards (team_id, card_id) values (v_team_id, v_card_id);
  end if;

  select exists(select 1 from station_properties where station_id = v_station_id and is_active) into v_has_properties;
  v_next_state := case when v_has_properties then 'PROPERTY_PURCHASE' else 'DICE_READY' end;

  update team_state
    set coin_balance_cache = coin_balance_cache + v_amount,
        mission_success_count = v_mission_success_count,
        current_station_id = v_station_id,
        state = v_next_state,
        current_turn_id = case when v_next_state = 'DICE_READY' then null else current_turn_id end,
        version = version + 1
    where team_id = v_team_id;

  update turns set status = 'COMPLETED', completed_at = now() where id = v_turn_id;

  insert into audit_log (event_id, staff_id, team_id, action_type, before_value, after_value)
    values (v_event_id, auth.uid(), v_team_id, 'MISSION_SUCCESS',
      jsonb_build_object('attempt_id', p_attempt_id), jsonb_build_object('amount', v_amount, 'type', v_ttype, 'card_id', v_card_id));
end;
$$;

-- ===================== fn_purchase_property / fn_finish_property_purchase =====================

create or replace function fn_purchase_property(p_property_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_state team_game_state;
  v_current_station uuid;
  v_property_station uuid;
  v_price bigint;
  v_yield bigint;
  v_balance bigint;
begin
  if v_team_id is null then raise exception 'participant only'; end if;

  select ts.state, ts.event_id, ts.current_station_id, ts.coin_balance_cache
    into v_state, v_event_id, v_current_station, v_balance
    from team_state ts where ts.team_id = v_team_id for update;

  perform fn_assert_event_active(v_event_id);
  if v_state <> 'PROPERTY_PURCHASE' then
    raise exception 'invalid state: %', v_state;
  end if;

  select station_id, price, yield_amount into v_property_station, v_price, v_yield
    from station_properties where id = p_property_id and is_active;
  if v_property_station is null then
    raise exception 'property not found';
  end if;
  if v_property_station <> v_current_station then
    raise exception 'this property is not available at your current station';
  end if;
  if v_balance < v_price then
    raise exception 'insufficient coin balance';
  end if;

  insert into team_property_purchases (team_id, property_id, price_paid, yield_amount, idempotency_key)
    values (v_team_id, p_property_id, v_price, v_yield, gen_random_uuid());

  insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
    values (v_event_id, v_team_id, -v_price, 'PROPERTY_PURCHASE', gen_random_uuid(), null, auth.uid());
  update team_state set coin_balance_cache = coin_balance_cache - v_price where team_id = v_team_id;
end;
$$;

create or replace function fn_finish_property_purchase()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_state team_game_state;
begin
  if v_team_id is null then raise exception 'participant only'; end if;
  select state into v_state from team_state where team_id = v_team_id for update;
  if v_state <> 'PROPERTY_PURCHASE' then
    raise exception 'invalid state: %', v_state;
  end if;
  update team_state set state = 'DICE_READY', current_turn_id = null, version = version + 1 where team_id = v_team_id;
end;
$$;

-- ===================== fn_admin_force_end_event: 物件の精算を追加 =====================

create or replace function fn_admin_force_end_event(p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_purchase record;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;

  for v_purchase in
    select tpp.id, tpp.team_id, tpp.price_paid, tpp.yield_amount
      from team_property_purchases tpp
      join teams t on t.id = tpp.team_id
      where t.event_id = v_staff_event_id and tpp.settled = false
  loop
    insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
      values (v_staff_event_id, v_purchase.team_id, v_purchase.price_paid + v_purchase.yield_amount,
        'PROPERTY_PAYOUT', gen_random_uuid(), '物件精算(購入代金+利回り)', auth.uid());
    update team_state set coin_balance_cache = coin_balance_cache + v_purchase.price_paid + v_purchase.yield_amount
      where team_id = v_purchase.team_id;
    update team_property_purchases set settled = true, settled_at = now() where id = v_purchase.id;
  end loop;

  update events set status = 'FORCE_ENDED', end_at = least(coalesce(end_at, now()), now()) where id = v_staff_event_id;

  insert into audit_log (event_id, staff_id, action_type, reason)
    values (v_staff_event_id, auth.uid(), 'EVENT_FORCE_END', p_reason);
end;
$$;

grant execute on function fn_pick_next_destination(uuid, uuid) to authenticated;
grant execute on function fn_admin_set_active_destination(uuid) to authenticated;
grant execute on function fn_admin_randomize_next_destination() to authenticated;
grant execute on function fn_purchase_property(uuid) to authenticated;
grant execute on function fn_finish_property_purchase() to authenticated;
