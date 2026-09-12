-- スタート駅自由選択 + 開始後チェックイン写真提出フロー。
--
-- 1. イベント開始前(SCHEDULED)、チームは全駅から自由にスタート駅を選べる(重複可)。
-- 2. イベント開始時、選んだ駅(未選択なら本部が指定したevents.start_station_id)を
--    current_station_idに設定し、DICE_READYではなくSTART_CHECKINへ遷移させる。
-- 3. チームはそのスタート駅で写真を提出(既存の到着報告と同じ1〜3枚)し、
--    本部の承認を得るとDICE_READYになり通常のゲームが始まる。却下されるとSTART_CHECKINに戻る。

alter table team_state add column if not exists selected_start_station_id uuid references stations(id);

create table team_start_checkins (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  station_id uuid not null references stations(id),
  status arrival_status not null default 'PENDING',
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references staff_users(id),
  reviewed_at timestamptz,
  review_reason text,
  idempotency_key uuid unique
);

create table start_checkin_photos (
  id uuid primary key default gen_random_uuid(),
  start_checkin_id uuid not null references team_start_checkins(id) on delete cascade,
  storage_path text not null,
  uploaded_at timestamptz not null default now()
);

alter table team_start_checkins enable row level security;
alter table start_checkin_photos enable row level security;

create policy team_start_checkins_select on team_start_checkins for select
  using (team_id = auth_team_id() or exists (
    select 1 from teams t where t.id = team_start_checkins.team_id and t.event_id = auth_staff_event_id()
  ));

create policy start_checkin_photos_select on start_checkin_photos for select
  using (exists (
    select 1 from team_start_checkins c join teams t on t.id = c.team_id
    where c.id = start_checkin_photos.start_checkin_id
      and (t.auth_user_id = auth.uid() or t.event_id = auth_staff_event_id())
  ));

-- ===================== fn_select_start_station =====================
-- イベント開始前のみ、参加者が自由にスタート駅を選ぶ(何度でも変更可・重複可)。

create or replace function fn_select_start_station(p_station_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_status event_status;
begin
  if v_team_id is null then
    raise exception 'participant only';
  end if;

  select event_id into v_event_id from team_state where team_id = v_team_id;
  select status into v_status from events where id = v_event_id;
  if v_status <> 'SCHEDULED' then
    raise exception 'event has already started';
  end if;

  if not exists (select 1 from stations where id = p_station_id and event_id = v_event_id) then
    raise exception 'invalid station';
  end if;

  update team_state set selected_start_station_id = p_station_id where team_id = v_team_id;
end;
$$;

grant execute on function fn_select_start_station(uuid) to authenticated;

-- ===================== fn_admin_set_start_station =====================
-- 本部が「デフォルトのスタート駅」(選ばなかったチームの起点)を設定する。

create or replace function fn_admin_set_start_station(p_station_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  if not exists (select 1 from stations where id = p_station_id and event_id = v_staff_event_id) then
    raise exception 'invalid station';
  end if;

  update events set start_station_id = p_station_id where id = v_staff_event_id;
end;
$$;

grant execute on function fn_admin_set_start_station(uuid) to authenticated;

-- ===================== fn_submit_start_checkin =====================
-- WAITING/START_CHECKIN → START_CHECKIN_REVIEW。写真1〜3枚必須(到着報告と同じ形式)。

create or replace function fn_submit_start_checkin(p_photo_paths text[], p_idempotency_key uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_state team_game_state;
  v_station_id uuid;
  v_id uuid;
  v_path text;
begin
  if v_team_id is null then
    raise exception 'participant only';
  end if;

  select id into v_id from team_start_checkins where idempotency_key = p_idempotency_key;
  if v_id is not null then
    return v_id;
  end if;

  select ts.state, ts.event_id, ts.current_station_id into v_state, v_event_id, v_station_id
    from team_state ts where ts.team_id = v_team_id for update;

  if v_state <> 'START_CHECKIN' then
    raise exception 'invalid state: %', v_state;
  end if;
  if v_station_id is null then
    raise exception 'no start station assigned';
  end if;
  if array_length(p_photo_paths, 1) is null or array_length(p_photo_paths, 1) < 1 or array_length(p_photo_paths, 1) > 3 then
    raise exception 'photo count must be 1-3';
  end if;

  foreach v_path in array p_photo_paths loop
    if split_part(v_path, '/', 1) <> v_event_id::text or split_part(v_path, '/', 2) <> v_team_id::text then
      raise exception 'invalid photo path: %', v_path;
    end if;
  end loop;

  insert into team_start_checkins (team_id, station_id, status, idempotency_key)
    values (v_team_id, v_station_id, 'PENDING', p_idempotency_key)
    returning id into v_id;

  insert into start_checkin_photos (start_checkin_id, storage_path)
    select v_id, unnest(p_photo_paths);

  insert into review_queue (event_id, team_id, type, ref_id)
    values (v_event_id, v_team_id, 'START_CHECKIN', v_id);

  update team_state set state = 'START_CHECKIN_REVIEW', version = version + 1 where team_id = v_team_id;

  return v_id;
end;
$$;

grant execute on function fn_submit_start_checkin(text[], uuid) to authenticated;

-- ===================== fn_review_start_checkin =====================
-- 本部の承認/却下。承認でDICE_READYへ、却下でSTART_CHECKINに戻し再提出させる。

create or replace function fn_review_start_checkin(p_start_checkin_id uuid, p_decision text, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_team_id uuid;
  v_event_id uuid;
begin
  if v_staff_event_id is null then
    raise exception 'staff only';
  end if;
  if p_decision not in ('APPROVE', 'REJECT') then
    raise exception 'invalid decision';
  end if;

  select c.team_id, t.event_id into v_team_id, v_event_id
    from team_start_checkins c
    join teams t on t.id = c.team_id
    where c.id = p_start_checkin_id;

  if v_event_id is null or v_event_id is distinct from v_staff_event_id then
    raise exception 'not found or not your event';
  end if;

  update review_queue
    set status = 'CLAIMED', claimed_by = auth.uid(), claimed_at = now()
    where event_id = v_event_id and team_id = v_team_id and type = 'START_CHECKIN'
      and ref_id = p_start_checkin_id and status = 'OPEN';
  if not found then
    raise exception 'already handled by another staff member';
  end if;

  perform 1 from team_state where team_id = v_team_id for update;

  if p_decision = 'REJECT' then
    update team_start_checkins
      set status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now(), review_reason = p_reason
      where id = p_start_checkin_id;
    update team_state set state = 'START_CHECKIN', version = version + 1 where team_id = v_team_id;
    update review_queue set status = 'RESOLVED'
      where event_id = v_event_id and team_id = v_team_id and type = 'START_CHECKIN' and ref_id = p_start_checkin_id;

    insert into audit_log (event_id, staff_id, team_id, action_type, before_value, reason)
      values (v_event_id, auth.uid(), v_team_id, 'START_CHECKIN_REJECT',
        jsonb_build_object('start_checkin_id', p_start_checkin_id), p_reason);
    return;
  end if;

  update team_start_checkins
    set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_start_checkin_id;

  update team_state set state = 'DICE_READY', version = version + 1 where team_id = v_team_id;
  update review_queue set status = 'RESOLVED'
    where event_id = v_event_id and team_id = v_team_id and type = 'START_CHECKIN' and ref_id = p_start_checkin_id;

  insert into audit_log (event_id, staff_id, team_id, action_type, before_value)
    values (v_event_id, auth.uid(), v_team_id, 'START_CHECKIN_APPROVE', jsonb_build_object('start_checkin_id', p_start_checkin_id));
end;
$$;

grant execute on function fn_review_start_checkin(uuid, text, text) to authenticated;

-- ===================== fn_start_event_core の更新 =====================
-- 各チームの現在駅を「選択したスタート駅(未選択ならevents.start_station_id)」に設定し、
-- DICE_READYではなくSTART_CHECKINへ遷移させる(チェックイン写真の承認を待つ)。

create or replace function fn_start_event_core(p_event_id uuid, p_time_limit_minutes int, p_end_at timestamptz)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_dest uuid;
  v_end_at timestamptz;
  v_minutes int;
  v_initial_funding bigint := 50000000;
  v_default_start_station_id uuid;
  v_team record;
begin
  if p_end_at is not null then
    if p_end_at <= now() then raise exception 'end_at must be in the future'; end if;
    v_end_at := p_end_at;
    v_minutes := ceil(extract(epoch from (p_end_at - now())) / 60)::int;
  else
    v_minutes := coalesce(p_time_limit_minutes, 240);
    v_end_at := now() + make_interval(mins => v_minutes);
  end if;

  v_dest := fn_pick_next_destination(p_event_id);
  select start_station_id into v_default_start_station_id from events where id = p_event_id;

  update events
    set status = 'RUNNING', start_at = now(), time_limit_minutes = v_minutes,
        end_at = v_end_at,
        active_destination_station_id = coalesce(active_destination_station_id, v_dest)
    where id = p_event_id;

  for v_team in select team_id as id, selected_start_station_id from team_state where event_id = p_event_id loop
    insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
      values (p_event_id, v_team.id, v_initial_funding, 'ADMIN_ADJUSTMENT', gen_random_uuid(), '初期資金', auth.uid());
    update team_state
      set coin_balance_cache = coin_balance_cache + v_initial_funding,
          current_station_id = coalesce(v_team.selected_start_station_id, v_default_start_station_id, current_station_id),
          state = 'START_CHECKIN',
          version = version + 1
      where team_id = v_team.id and state = 'WAITING';
  end loop;

  insert into audit_log (event_id, staff_id, action_type, after_value)
    values (p_event_id, auth.uid(), 'EVENT_START',
      jsonb_build_object('time_limit_minutes', v_minutes, 'end_at', v_end_at, 'first_destination', v_dest, 'initial_funding', v_initial_funding));
end;
$$;

-- ===================== fn_admin_rehearsal_reset の更新 =====================
-- 1) team_start_checkins/start_checkin_photos・selected_start_station_idもリセット対象に追加。
-- 2) リセット後の起点駅は、たまたま存在するチームの現在地ではなく events.start_station_id を
--    正として使う(デモ/テストでチームの現在地が荒れていても、常に本部が決めた起点に戻るように)。

create or replace function fn_admin_rehearsal_reset()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_start_station_id uuid;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;

  select start_station_id into v_start_station_id from events where id = v_staff_event_id;

  update team_state set current_turn_id = null where event_id = v_staff_event_id;

  delete from coin_ledger where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from card_usage_log where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from team_mission_attempts where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from team_bonus_mission_attempts where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from team_property_purchases where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from team_cards where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from card_active_effects where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from card_notifications where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from team_start_checkins where team_id in (select id from teams where event_id = v_staff_event_id);
  delete from turns where team_id in (select id from teams where event_id = v_staff_event_id);

  delete from review_queue where event_id = v_staff_event_id;
  delete from destination_queue where event_id = v_staff_event_id;
  delete from audit_log where event_id = v_staff_event_id;
  delete from leaderboard_snapshots where event_id = v_staff_event_id;

  update team_state set
    state = 'WAITING',
    current_station_id = v_start_station_id,
    selected_start_station_id = null,
    current_turn_id = null,
    mission_success_count = 0,
    is_paused = false,
    paused_from_state = null,
    reroll_allowed = false,
    coin_balance_cache = 0,
    has_bombii = false,
    pending_money_god_bonus = false,
    arrival_count = 0,
    card_use_count = 0
  where event_id = v_staff_event_id;

  update events set
    status = 'SCHEDULED',
    start_at = null,
    end_at = null,
    time_limit_minutes = null,
    scheduled_start_at = null,
    auto_start_enabled = false,
    auto_start_time_limit_minutes = null,
    auto_start_end_at = null,
    last_dividend_run_at = null,
    active_destination_station_id = null,
    normal_arrival_count = 0,
    money_god_awarded = false,
    last_lucky_hourly_run_at = null,
    leaderboard_snapshot_interval_minutes = 0,
    last_leaderboard_snapshot_at = null
  where id = v_staff_event_id;
end;
$$;
