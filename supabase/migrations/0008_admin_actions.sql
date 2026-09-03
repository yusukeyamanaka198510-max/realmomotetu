-- Phase 5: 本部の手動調整権限・イベント開始/終了・目的地キュー管理・一時停止

alter table team_state add column paused_from_state team_game_state;

-- ===================== イベント稼働チェック(参加者操作の共通ガード) =====================
create or replace function fn_assert_event_active(p_event_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status event_status;
  v_end_at timestamptz;
begin
  select status, end_at into v_status, v_end_at from events where id = p_event_id;
  if v_status <> 'RUNNING' then
    raise exception 'event is not running';
  end if;
  if v_end_at is not null and now() > v_end_at then
    raise exception 'event time limit reached';
  end if;
end;
$$;

-- ===================== 参加者向けRPCにイベント稼働チェックを追加(再定義) =====================

create or replace function fn_start_arrival() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_state team_game_state;
begin
  if v_team_id is null then raise exception 'participant only'; end if;
  select state, event_id into v_state, v_event_id from team_state where team_id = v_team_id for update;
  perform fn_assert_event_active(v_event_id);
  if v_state = 'ARRIVAL_SUBMISSION' then return; end if;
  if v_state <> 'TRAVELING' then raise exception 'invalid state: %', v_state; end if;
  update team_state set state = 'ARRIVAL_SUBMISSION', version = version + 1 where team_id = v_team_id;
end;
$$;

create or replace function fn_submit_arrival(p_photo_paths text[], p_idempotency_key uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_state team_game_state;
  v_turn_id uuid;
  v_station_id uuid;
  v_id uuid;
  v_path text;
begin
  if v_team_id is null then raise exception 'participant only'; end if;

  select id into v_id from arrival_submissions where idempotency_key = p_idempotency_key;
  if v_id is not null then return v_id; end if;

  select ts.state, ts.event_id, ts.current_turn_id, t.next_station_id
    into v_state, v_event_id, v_turn_id, v_station_id
    from team_state ts join turns t on t.id = ts.current_turn_id
    where ts.team_id = v_team_id for update of ts;

  perform fn_assert_event_active(v_event_id);
  if v_state <> 'ARRIVAL_SUBMISSION' then raise exception 'invalid state: %', v_state; end if;
  if v_turn_id is null or v_station_id is null then raise exception 'no active turn/destination'; end if;
  if array_length(p_photo_paths, 1) is null or array_length(p_photo_paths, 1) < 1 or array_length(p_photo_paths, 1) > 3 then
    raise exception 'photo count must be 1-3';
  end if;
  foreach v_path in array p_photo_paths loop
    if split_part(v_path, '/', 1) <> v_event_id::text or split_part(v_path, '/', 2) <> v_team_id::text then
      raise exception 'invalid photo path: %', v_path;
    end if;
  end loop;

  insert into arrival_submissions (team_id, turn_id, station_id, status, idempotency_key)
    values (v_team_id, v_turn_id, v_station_id, 'PENDING', p_idempotency_key)
    returning id into v_id;
  insert into arrival_photos (arrival_submission_id, storage_path) select v_id, unnest(p_photo_paths);
  insert into review_queue (event_id, team_id, type, ref_id) values (v_event_id, v_team_id, 'ARRIVAL', v_id);
  update team_state set state = 'ARRIVAL_REVIEW', version = version + 1 where team_id = v_team_id;
  return v_id;
end;
$$;

create or replace function fn_select_mission(p_attempt_id uuid, p_selected_mission_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_state team_game_state;
  v_offered uuid[];
  v_locked timestamptz;
  v_attempt_team_id uuid;
begin
  if v_team_id is null then raise exception 'participant only'; end if;

  select ts.state, ts.event_id, a.offered_mission_ids, a.locked_at, a.team_id
    into v_state, v_event_id, v_offered, v_locked, v_attempt_team_id
    from team_state ts join team_mission_attempts a on a.id = p_attempt_id
    where ts.team_id = v_team_id for update of ts;

  perform fn_assert_event_active(v_event_id);
  if v_attempt_team_id is null or v_attempt_team_id <> v_team_id then raise exception 'not your mission attempt'; end if;
  if v_locked is not null then return; end if;
  if v_state <> 'MISSION_SELECTION' then raise exception 'invalid state: %', v_state; end if;
  if not (p_selected_mission_id = any (v_offered)) then raise exception 'mission not offered'; end if;

  update team_mission_attempts
    set selected_mission_id = p_selected_mission_id, locked_at = now(), status = 'AWAITING_PHOTO'
    where id = p_attempt_id;
  update team_state set state = 'MISSION_ACTIVE', version = version + 1 where team_id = v_team_id;
end;
$$;

create or replace function fn_submit_mission_photos(p_attempt_id uuid, p_photo_paths text[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_state team_game_state;
  v_status mission_attempt_status;
  v_attempt_team_id uuid;
  v_path text;
begin
  if v_team_id is null then raise exception 'participant only'; end if;

  select ts.state, ts.event_id, a.status, a.team_id
    into v_state, v_event_id, v_status, v_attempt_team_id
    from team_state ts join team_mission_attempts a on a.id = p_attempt_id
    where ts.team_id = v_team_id for update of ts;

  perform fn_assert_event_active(v_event_id);
  if v_attempt_team_id is null or v_attempt_team_id <> v_team_id then raise exception 'not your mission attempt'; end if;
  if v_status = 'PENDING_REVIEW' then return; end if;
  if v_state <> 'MISSION_ACTIVE' or v_status <> 'AWAITING_PHOTO' then raise exception 'invalid state'; end if;
  if array_length(p_photo_paths, 1) is null or array_length(p_photo_paths, 1) < 1 or array_length(p_photo_paths, 1) > 3 then
    raise exception 'photo count must be 1-3';
  end if;
  foreach v_path in array p_photo_paths loop
    if split_part(v_path, '/', 1) <> v_event_id::text or split_part(v_path, '/', 2) <> v_team_id::text then
      raise exception 'invalid photo path: %', v_path;
    end if;
  end loop;

  insert into mission_photos (mission_attempt_id, storage_path) select p_attempt_id, unnest(p_photo_paths);
  update team_mission_attempts set status = 'PENDING_REVIEW' where id = p_attempt_id;
  insert into review_queue (event_id, team_id, type, ref_id) values (v_event_id, v_team_id, 'MISSION', p_attempt_id);
  update team_state set state = 'MISSION_REVIEW', version = version + 1 where team_id = v_team_id;
end;
$$;

create or replace function fn_roll_dice(p_dice_count int default 1)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_state team_game_state;
  v_current_station uuid;
  v_last_turn_number int;
  v_turn_id uuid;
  v_results int[] := array[]::int[];
  v_total int := 0;
  v_roll int;
  v_dice_roll_id uuid;
  v_reachable uuid[];
  v_used_relaxed boolean := false;
  v_station uuid;
  i int;
begin
  if v_team_id is null then raise exception 'participant only'; end if;
  if p_dice_count < 1 or p_dice_count > 6 then raise exception 'invalid dice_count'; end if;

  select ts.state, ts.event_id, ts.current_station_id
    into v_state, v_event_id, v_current_station
    from team_state ts where ts.team_id = v_team_id for update;

  perform fn_assert_event_active(v_event_id);
  if v_state <> 'DICE_READY' then raise exception 'invalid state: %', v_state; end if;

  select coalesce(max(turn_number), 0) into v_last_turn_number from turns where team_id = v_team_id;

  for i in 1..p_dice_count loop
    v_roll := 1 + floor(random() * 6)::int;
    v_results := v_results || v_roll;
    v_total := v_total + v_roll;
  end loop;

  insert into turns (team_id, turn_number, previous_station_id, status)
    values (v_team_id, v_last_turn_number + 1, v_current_station, 'IN_PROGRESS')
    returning id into v_turn_id;

  insert into dice_rolls (team_id, turn_id, idempotency_key, dice_count, individual_results, total, rolled_at, created_by)
    values (v_team_id, v_turn_id, gen_random_uuid(), p_dice_count, v_results, v_total, now(), auth.uid())
    returning id into v_dice_roll_id;

  select array_agg(station_id) into v_reachable from fn_reachable_stations(v_current_station, v_event_id, v_total, false);
  if v_reachable is null or array_length(v_reachable, 1) is null then
    v_used_relaxed := true;
    select array_agg(station_id) into v_reachable from fn_reachable_stations(v_current_station, v_event_id, v_total, true);
  end if;

  foreach v_station in array coalesce(v_reachable, array[]::uuid[]) loop
    insert into reachable_stations_snapshot (dice_roll_id, station_id, used_relaxed_revisit_rule)
      values (v_dice_roll_id, v_station, v_used_relaxed);
  end loop;

  update team_state set state = 'DESTINATION_SELECTION', current_turn_id = v_turn_id, version = version + 1
    where team_id = v_team_id;

  return v_dice_roll_id;
end;
$$;

create or replace function fn_select_destination(p_station_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_state team_game_state;
  v_turn_id uuid;
  v_dice_roll_id uuid;
  v_valid boolean;
begin
  if v_team_id is null then raise exception 'participant only'; end if;

  select ts.state, ts.event_id, ts.current_turn_id into v_state, v_event_id, v_turn_id
    from team_state ts where ts.team_id = v_team_id for update;

  perform fn_assert_event_active(v_event_id);
  if v_state <> 'DESTINATION_SELECTION' then raise exception 'invalid state: %', v_state; end if;

  select id into v_dice_roll_id from dice_rolls where turn_id = v_turn_id and is_valid order by rolled_at desc limit 1;
  select exists (
    select 1 from reachable_stations_snapshot where dice_roll_id = v_dice_roll_id and station_id = p_station_id
  ) into v_valid;
  if not v_valid then raise exception 'station not reachable'; end if;

  if exists (select 1 from destination_selections where turn_id = v_turn_id) then return; end if;

  insert into destination_selections (team_id, turn_id, dice_roll_id, selected_station_id, idempotency_key)
    values (v_team_id, v_turn_id, v_dice_roll_id, p_station_id, gen_random_uuid());
  update turns set next_station_id = p_station_id where id = v_turn_id;
  update team_state set state = 'TRAVELING', version = version + 1 where team_id = v_team_id;
end;
$$;

-- ===================== 本部: コイン調整 / 遅刻減点 =====================

create or replace function fn_admin_adjust_coin(p_team_id uuid, p_amount bigint, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_event_id uuid;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  select event_id into v_event_id from team_state where team_id = p_team_id for update;
  if v_event_id is distinct from v_staff_event_id then raise exception 'not your event'; end if;

  insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
    values (v_event_id, p_team_id, p_amount, 'ADMIN_ADJUSTMENT', gen_random_uuid(), p_reason, auth.uid());
  update team_state set coin_balance_cache = coin_balance_cache + p_amount where team_id = p_team_id;

  insert into audit_log (event_id, staff_id, team_id, action_type, after_value, reason)
    values (v_event_id, auth.uid(), p_team_id, 'ADMIN_ADJUSTMENT', jsonb_build_object('amount', p_amount), p_reason);
end;
$$;

create or replace function fn_admin_late_penalty(p_team_id uuid, p_amount bigint, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_event_id uuid;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  select event_id into v_event_id from team_state where team_id = p_team_id for update;
  if v_event_id is distinct from v_staff_event_id then raise exception 'not your event'; end if;

  insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
    values (v_event_id, p_team_id, -abs(p_amount), 'LATE_PENALTY', gen_random_uuid(), p_reason, auth.uid());
  update team_state set coin_balance_cache = coin_balance_cache - abs(p_amount) where team_id = p_team_id;

  insert into audit_log (event_id, staff_id, team_id, action_type, after_value, reason)
    values (v_event_id, auth.uid(), p_team_id, 'LATE_PENALTY', jsonb_build_object('amount', -abs(p_amount)), p_reason);
end;
$$;

-- ===================== 本部: 現在駅/次駅の手動修正 =====================

create or replace function fn_admin_correct_station(p_team_id uuid, p_current_station_id uuid, p_next_station_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_event_id uuid;
  v_turn_id uuid;
  v_before jsonb;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  select event_id, current_turn_id into v_event_id, v_turn_id from team_state where team_id = p_team_id for update;
  if v_event_id is distinct from v_staff_event_id then raise exception 'not your event'; end if;

  select jsonb_build_object('current_station_id', current_station_id) into v_before from team_state where team_id = p_team_id;

  if p_current_station_id is not null then
    update team_state set current_station_id = p_current_station_id where team_id = p_team_id;
  end if;
  if p_next_station_id is not null and v_turn_id is not null then
    update turns set next_station_id = p_next_station_id where id = v_turn_id;
  end if;

  insert into audit_log (event_id, staff_id, team_id, action_type, before_value, after_value, reason)
    values (v_event_id, auth.uid(), p_team_id, 'STATION_CORRECTION', v_before,
      jsonb_build_object('current_station_id', p_current_station_id, 'next_station_id', p_next_station_id), p_reason);
end;
$$;

-- ===================== 本部: ミッション強制成功/失敗 =====================

create or replace function fn_admin_force_mission_result(p_attempt_id uuid, p_decision text, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_team_id uuid;
  v_event_id uuid;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  select a.team_id, t.event_id into v_team_id, v_event_id
    from team_mission_attempts a join teams t on t.id = a.team_id
    where a.id = p_attempt_id;
  if v_event_id is distinct from v_staff_event_id then raise exception 'not your event'; end if;

  -- review_queueに乗っていない場合(まだ写真提出前など)でも判定できるよう、
  -- 未OPENなら仮のOPENエントリを作ってからfn_review_missionのロジックへ委譲する。
  if not exists (
    select 1 from review_queue where event_id = v_event_id and team_id = v_team_id and type = 'MISSION' and ref_id = p_attempt_id and status = 'OPEN'
  ) then
    insert into review_queue (event_id, team_id, type, ref_id, status) values (v_event_id, v_team_id, 'MISSION', p_attempt_id, 'OPEN');
  end if;

  perform fn_review_mission(p_attempt_id, p_decision, coalesce(p_reason, '本部による強制判定'));

  insert into audit_log (event_id, staff_id, team_id, action_type, reason)
    values (v_event_id, auth.uid(), v_team_id, 'MISSION_FORCE_' || p_decision, p_reason);
end;
$$;

-- ===================== 本部: チーム一時停止/再開 =====================

create or replace function fn_admin_set_paused(p_team_id uuid, p_pause boolean, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_event_id uuid;
  v_state team_game_state;
  v_paused_from team_game_state;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  select event_id, state, paused_from_state into v_event_id, v_state, v_paused_from
    from team_state where team_id = p_team_id for update;
  if v_event_id is distinct from v_staff_event_id then raise exception 'not your event'; end if;

  if p_pause then
    if v_state = 'PAUSED' then return; end if;
    update team_state set state = 'PAUSED', paused_from_state = v_state, is_paused = true, version = version + 1
      where team_id = p_team_id;
  else
    if v_state <> 'PAUSED' then return; end if;
    update team_state set state = coalesce(v_paused_from, 'WAITING'), paused_from_state = null, is_paused = false, version = version + 1
      where team_id = p_team_id;
  end if;

  insert into audit_log (event_id, staff_id, team_id, action_type, before_value, after_value, reason)
    values (v_event_id, auth.uid(), p_team_id, case when p_pause then 'TEAM_PAUSE' else 'TEAM_RESUME' end,
      jsonb_build_object('state', v_state), jsonb_build_object('paused', p_pause), p_reason);
end;
$$;

-- ===================== 本部: イベント開始・強制終了 =====================

create or replace function fn_admin_start_event(p_time_limit_minutes int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  update events
    set status = 'RUNNING', start_at = now(), time_limit_minutes = p_time_limit_minutes,
        end_at = now() + make_interval(mins => p_time_limit_minutes)
    where id = v_staff_event_id;

  insert into audit_log (event_id, staff_id, action_type, after_value)
    values (v_staff_event_id, auth.uid(), 'EVENT_START', jsonb_build_object('time_limit_minutes', p_time_limit_minutes));
end;
$$;

create or replace function fn_admin_force_end_event(p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  update events set status = 'FORCE_ENDED', end_at = least(coalesce(end_at, now()), now()) where id = v_staff_event_id;

  insert into audit_log (event_id, staff_id, action_type, reason)
    values (v_staff_event_id, auth.uid(), 'EVENT_FORCE_END', p_reason);
end;
$$;

-- ===================== 本部: 目的地キュー追加 =====================

create or replace function fn_admin_add_destination(p_station_id uuid, p_bonus_coin_amount bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_next_seq int;
  v_has_active boolean;
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;

  select coalesce(max(sequence_order), 0) + 1 into v_next_seq from destination_queue where event_id = v_staff_event_id;
  select exists(select 1 from destination_queue where event_id = v_staff_event_id and status = 'ACTIVE') into v_has_active;

  insert into destination_queue (event_id, station_id, sequence_order, bonus_coin_amount, status)
    values (v_staff_event_id, p_station_id, v_next_seq, p_bonus_coin_amount, case when v_has_active then 'PENDING' else 'ACTIVE' end);

  insert into audit_log (event_id, staff_id, action_type, after_value)
    values (v_staff_event_id, auth.uid(), 'DESTINATION_ADD', jsonb_build_object('station_id', p_station_id, 'bonus', p_bonus_coin_amount));
end;
$$;

grant execute on function fn_admin_adjust_coin(uuid, bigint, text) to authenticated;
grant execute on function fn_admin_late_penalty(uuid, bigint, text) to authenticated;
grant execute on function fn_admin_correct_station(uuid, uuid, uuid, text) to authenticated;
grant execute on function fn_admin_force_mission_result(uuid, text, text) to authenticated;
grant execute on function fn_admin_set_paused(uuid, boolean, text) to authenticated;
grant execute on function fn_admin_start_event(int) to authenticated;
grant execute on function fn_admin_force_end_event(text) to authenticated;
grant execute on function fn_admin_add_destination(uuid, bigint) to authenticated;

alter publication supabase_realtime add table events;
alter publication supabase_realtime add table destination_queue;
