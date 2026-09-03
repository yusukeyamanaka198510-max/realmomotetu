-- Phase 4: サーバーサイドサイコロ・経路探索・移動先選択・ターン生成
-- DICE_READY → (サイコロ確定・経路計算) → DESTINATION_SELECTION → TRAVELING
-- ROLLING状態は将来の演出用に予約し、v1では確定処理を単一トランザクションで完結させる。

-- ===================== fn_reachable_stations =====================
-- 現在駅からちょうどp_n Edge移動した場合に到達可能な駅を返す。
-- p_relaxed=false: 同一ターン内で同じ駅を2度通らない単純経路のみ。
-- p_relaxed=true : 行き止まりで到達可能駅が0件になった場合の救済(再訪を許可)。

create or replace function fn_reachable_stations(p_start uuid, p_event_id uuid, p_n int, p_relaxed boolean)
returns table(station_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  if p_n <= 0 then
    return;
  end if;

  if not p_relaxed then
    return query
      with recursive walk(sid, depth, visited) as (
        select p_start, 0, array[p_start]
        union all
        select nxt.other, w.depth + 1, w.visited || nxt.other
        from walk w
        join lateral (
          select case when ed.station_a_id = w.sid then ed.station_b_id else ed.station_a_id end as other
          from edges ed
          where ed.event_id = p_event_id and (ed.station_a_id = w.sid or ed.station_b_id = w.sid)
        ) nxt on true
        where w.depth < p_n and not (nxt.other = any (w.visited))
      )
      select distinct sid from walk where depth = p_n;
  else
    return query
      with recursive walk(sid, depth) as (
        select p_start, 0
        union all
        select nxt.other, w.depth + 1
        from walk w
        join lateral (
          select case when ed.station_a_id = w.sid then ed.station_b_id else ed.station_a_id end as other
          from edges ed
          where ed.event_id = p_event_id and (ed.station_a_id = w.sid or ed.station_b_id = w.sid)
        ) nxt on true
        where w.depth < p_n
      )
      select distinct sid from walk where depth = p_n;
  end if;
end;
$$;

-- ===================== fn_roll_dice =====================
-- DICE_READY → DESTINATION_SELECTION。サーバー側で乱数確定し、到達可能駅を計算してスナップショット保存する。

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
  if v_team_id is null then
    raise exception 'participant only';
  end if;
  if p_dice_count < 1 or p_dice_count > 6 then
    raise exception 'invalid dice_count';
  end if;

  select ts.state, ts.event_id, ts.current_station_id
    into v_state, v_event_id, v_current_station
    from team_state ts where ts.team_id = v_team_id for update;

  if v_state <> 'DICE_READY' then
    raise exception 'invalid state: %', v_state;
  end if;

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

  select array_agg(station_id) into v_reachable
    from fn_reachable_stations(v_current_station, v_event_id, v_total, false);

  if v_reachable is null or array_length(v_reachable, 1) is null then
    v_used_relaxed := true;
    select array_agg(station_id) into v_reachable
      from fn_reachable_stations(v_current_station, v_event_id, v_total, true);
  end if;

  foreach v_station in array coalesce(v_reachable, array[]::uuid[]) loop
    insert into reachable_stations_snapshot (dice_roll_id, station_id, used_relaxed_revisit_rule)
      values (v_dice_roll_id, v_station, v_used_relaxed);
  end loop;

  update team_state
    set state = 'DESTINATION_SELECTION', current_turn_id = v_turn_id, version = version + 1
    where team_id = v_team_id;

  return v_dice_roll_id;
end;
$$;

-- ===================== fn_select_destination =====================
-- DESTINATION_SELECTION → TRAVELING。確定後は変更不可。二重確定は無害化。

create or replace function fn_select_destination(p_station_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_state team_game_state;
  v_turn_id uuid;
  v_dice_roll_id uuid;
  v_valid boolean;
begin
  if v_team_id is null then
    raise exception 'participant only';
  end if;

  select ts.state, ts.current_turn_id into v_state, v_turn_id
    from team_state ts where ts.team_id = v_team_id for update;

  if v_state <> 'DESTINATION_SELECTION' then
    raise exception 'invalid state: %', v_state;
  end if;

  select id into v_dice_roll_id from dice_rolls
    where turn_id = v_turn_id and is_valid order by rolled_at desc limit 1;

  select exists (
    select 1 from reachable_stations_snapshot
    where dice_roll_id = v_dice_roll_id and station_id = p_station_id
  ) into v_valid;
  if not v_valid then
    raise exception 'station not reachable';
  end if;

  if exists (select 1 from destination_selections where turn_id = v_turn_id) then
    return;
  end if;

  insert into destination_selections (team_id, turn_id, dice_roll_id, selected_station_id, idempotency_key)
    values (v_team_id, v_turn_id, v_dice_roll_id, p_station_id, gen_random_uuid());

  update turns set next_station_id = p_station_id where id = v_turn_id;
  update team_state set state = 'TRAVELING', version = version + 1 where team_id = v_team_id;
end;
$$;

-- ===================== fn_admin_invalidate_dice =====================
-- トラブル救済用。DESTINATION_SELECTION中のみ、本部が直前のサイコロ結果を無効化しDICE_READYへ戻す。

create or replace function fn_admin_invalidate_dice(p_team_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
  v_event_id uuid;
  v_state team_game_state;
  v_turn_id uuid;
  v_dice_roll_id uuid;
begin
  if v_staff_event_id is null then
    raise exception 'staff only';
  end if;

  select ts.state, ts.event_id, ts.current_turn_id into v_state, v_event_id, v_turn_id
    from team_state ts where ts.team_id = p_team_id for update;

  if v_event_id is distinct from v_staff_event_id then
    raise exception 'not your event';
  end if;
  if v_state <> 'DESTINATION_SELECTION' then
    raise exception 'invalid state: %', v_state;
  end if;

  select id into v_dice_roll_id from dice_rolls
    where turn_id = v_turn_id and is_valid order by rolled_at desc limit 1;

  update dice_rolls
    set is_valid = false, invalidated_at = now(), invalidated_by = auth.uid(), invalidation_reason = p_reason
    where id = v_dice_roll_id;

  update turns set status = 'ABORTED' where id = v_turn_id;
  update team_state
    set state = 'DICE_READY', current_turn_id = null, reroll_allowed = false, version = version + 1
    where team_id = p_team_id;

  insert into audit_log (event_id, staff_id, team_id, action_type, before_value, reason)
    values (v_event_id, auth.uid(), p_team_id, 'DICE_REROLL', jsonb_build_object('dice_roll_id', v_dice_roll_id), p_reason);
end;
$$;

grant execute on function fn_roll_dice(int) to authenticated;
grant execute on function fn_select_destination(uuid) to authenticated;
grant execute on function fn_admin_invalidate_dice(uuid, text) to authenticated;

alter publication supabase_realtime add table dice_rolls;
alter publication supabase_realtime add table turns;
alter publication supabase_realtime add table destination_selections;
