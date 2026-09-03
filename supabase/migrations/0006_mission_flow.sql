-- Phase 3: ミッション3択 → 選択ロック → 写真提出 → 本部判定 → Coin Ledger(5回ごとボーナス込み)

-- ===================== fn_generate_offered_missions =====================
-- 駅の9ミッション(EASY/NORMAL/HARD各3)から、そのチームが過去に選択したことのない
-- ミッションを難易度ごとに1つずつ選ぶ(全て選択済みならcreated_atが最も古いものを再利用)。
-- 表示順はランダムにシャッフルする(難易度を推測させないため)。

create or replace function fn_generate_offered_missions(p_team_id uuid, p_station_id uuid)
returns uuid[]
language plpgsql security definer set search_path = public as $$
declare
  v_easy uuid;
  v_normal uuid;
  v_hard uuid;
  v_result uuid[];
begin
  select id into v_easy from station_missions
    where station_id = p_station_id and difficulty = 'EASY' and is_active
      and id <> all (
        select selected_mission_id from team_mission_attempts
        where team_id = p_team_id and selected_mission_id is not null
      )
    order by created_at limit 1;
  if v_easy is null then
    select id into v_easy from station_missions
      where station_id = p_station_id and difficulty = 'EASY' and is_active
      order by created_at limit 1;
  end if;

  select id into v_normal from station_missions
    where station_id = p_station_id and difficulty = 'NORMAL' and is_active
      and id <> all (
        select selected_mission_id from team_mission_attempts
        where team_id = p_team_id and selected_mission_id is not null
      )
    order by created_at limit 1;
  if v_normal is null then
    select id into v_normal from station_missions
      where station_id = p_station_id and difficulty = 'NORMAL' and is_active
      order by created_at limit 1;
  end if;

  select id into v_hard from station_missions
    where station_id = p_station_id and difficulty = 'HARD' and is_active
      and id <> all (
        select selected_mission_id from team_mission_attempts
        where team_id = p_team_id and selected_mission_id is not null
      )
    order by created_at limit 1;
  if v_hard is null then
    select id into v_hard from station_missions
      where station_id = p_station_id and difficulty = 'HARD' and is_active
      order by created_at limit 1;
  end if;

  select array_agg(x order by random()) into v_result from unnest(array[v_easy, v_normal, v_hard]) x;
  return v_result;
end;
$$;

-- ===================== fn_review_arrival を再定義(承認時にミッション提示を追加) =====================

create or replace function fn_review_arrival(p_arrival_submission_id uuid, p_decision text, p_reason text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_team_id uuid;
  v_station_id uuid;
  v_turn_id uuid;
  v_event_id uuid;
  v_dest_id uuid;
  v_bonus bigint;
  v_offered uuid[];
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

  select id, coalesce(bonus_coin_amount, (select default_destination_bonus_amount from events where id = v_event_id))
    into v_dest_id, v_bonus
    from destination_queue
    where event_id = v_event_id and status = 'ACTIVE' and station_id = v_station_id
    for update;

  if v_dest_id is not null then
    update destination_queue
      set status = 'CLEARED', cleared_by_team_id = v_team_id, cleared_at = now()
      where id = v_dest_id;

    insert into coin_ledger (event_id, team_id, amount, transaction_type, idempotency_key, reason, created_by)
      values (v_event_id, v_team_id, v_bonus, 'DESTINATION_BONUS', gen_random_uuid(), '最終目的地到達ボーナス', auth.uid());
    update team_state set coin_balance_cache = coin_balance_cache + v_bonus where team_id = v_team_id;

    update destination_queue
      set status = 'ACTIVE'
      where event_id = v_event_id and status = 'PENDING'
        and sequence_order = (
          select min(sequence_order) from destination_queue
          where event_id = v_event_id and status = 'PENDING'
        );

    insert into audit_log (event_id, staff_id, team_id, action_type, before_value, after_value)
      values (v_event_id, auth.uid(), v_team_id, 'DESTINATION_BONUS',
        jsonb_build_object('destination_id', v_dest_id), jsonb_build_object('bonus', v_bonus));
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

-- ===================== fn_select_mission =====================
-- MISSION_SELECTION → MISSION_ACTIVE。選択後は変更不可(locked_at)。二重タップは無害化。

create or replace function fn_select_mission(p_attempt_id uuid, p_selected_mission_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_state team_game_state;
  v_offered uuid[];
  v_locked timestamptz;
  v_attempt_team_id uuid;
begin
  if v_team_id is null then
    raise exception 'participant only';
  end if;

  select ts.state, a.offered_mission_ids, a.locked_at, a.team_id
    into v_state, v_offered, v_locked, v_attempt_team_id
    from team_state ts
    join team_mission_attempts a on a.id = p_attempt_id
    where ts.team_id = v_team_id
    for update of ts;

  if v_attempt_team_id is null or v_attempt_team_id <> v_team_id then
    raise exception 'not your mission attempt';
  end if;
  if v_locked is not null then
    return;
  end if;
  if v_state <> 'MISSION_SELECTION' then
    raise exception 'invalid state: %', v_state;
  end if;
  if not (p_selected_mission_id = any (v_offered)) then
    raise exception 'mission not offered';
  end if;

  update team_mission_attempts
    set selected_mission_id = p_selected_mission_id, locked_at = now(), status = 'AWAITING_PHOTO'
    where id = p_attempt_id;
  update team_state set state = 'MISSION_ACTIVE', version = version + 1 where team_id = v_team_id;
end;
$$;

-- ===================== fn_submit_mission_photos =====================
-- MISSION_ACTIVE → MISSION_REVIEW。写真1〜3枚必須。

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
  if v_team_id is null then
    raise exception 'participant only';
  end if;

  select ts.state, ts.event_id, a.status, a.team_id
    into v_state, v_event_id, v_status, v_attempt_team_id
    from team_state ts
    join team_mission_attempts a on a.id = p_attempt_id
    where ts.team_id = v_team_id
    for update of ts;

  if v_attempt_team_id is null or v_attempt_team_id <> v_team_id then
    raise exception 'not your mission attempt';
  end if;
  if v_status = 'PENDING_REVIEW' then
    return;
  end if;
  if v_state <> 'MISSION_ACTIVE' or v_status <> 'AWAITING_PHOTO' then
    raise exception 'invalid state';
  end if;
  if array_length(p_photo_paths, 1) is null or array_length(p_photo_paths, 1) < 1 or array_length(p_photo_paths, 1) > 3 then
    raise exception 'photo count must be 1-3';
  end if;

  foreach v_path in array p_photo_paths loop
    if split_part(v_path, '/', 1) <> v_event_id::text or split_part(v_path, '/', 2) <> v_team_id::text then
      raise exception 'invalid photo path: %', v_path;
    end if;
  end loop;

  insert into mission_photos (mission_attempt_id, storage_path)
    select p_attempt_id, unnest(p_photo_paths);

  update team_mission_attempts set status = 'PENDING_REVIEW' where id = p_attempt_id;

  insert into review_queue (event_id, team_id, type, ref_id)
    values (v_event_id, v_team_id, 'MISSION', p_attempt_id);

  update team_state set state = 'MISSION_REVIEW', version = version + 1 where team_id = v_team_id;
end;
$$;

-- ===================== fn_review_mission =====================
-- 成功: 報酬付与(5回ごとに2倍) → DICE_READY。失敗: 減算(毎回) → 同一ミッションで再挑戦(MISSION_ACTIVE)。

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
      coalesce(success_reward, case difficulty when 'EASY' then 500 when 'NORMAL' then 1000 when 'HARD' then 2000 end),
      coalesce(failure_penalty, case difficulty when 'EASY' then 250 when 'NORMAL' then 500 when 'HARD' then 1000 end)
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

  update team_state
    set coin_balance_cache = coin_balance_cache + v_amount,
        mission_success_count = v_mission_success_count,
        state = 'DICE_READY',
        current_turn_id = null,
        version = version + 1
    where team_id = v_team_id;

  update turns set status = 'COMPLETED', completed_at = now() where id = v_turn_id;

  insert into audit_log (event_id, staff_id, team_id, action_type, before_value, after_value)
    values (v_event_id, auth.uid(), v_team_id, 'MISSION_SUCCESS',
      jsonb_build_object('attempt_id', p_attempt_id), jsonb_build_object('amount', v_amount, 'type', v_ttype));
end;
$$;

grant execute on function fn_select_mission(uuid, uuid) to authenticated;
grant execute on function fn_submit_mission_photos(uuid, text[]) to authenticated;
grant execute on function fn_review_mission(uuid, text, text) to authenticated;

alter publication supabase_realtime add table team_mission_attempts;
