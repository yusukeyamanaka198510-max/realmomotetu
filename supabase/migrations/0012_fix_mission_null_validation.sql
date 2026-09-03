-- バグ修正: ミッションが1件も登録されていない駅でfn_generate_offered_missionsが
-- NULLを含む配列を返し、fn_select_mission側の「提示されたミッションか」判定が
-- SQLの三値論理(NULL = ANY(array)はNULLになりtrueと判定されない)により
-- 誤って通過してしまい、後段のcoin_ledger挿入時にNOT NULL制約違反という分かりにくい
-- エラーになっていた。ミッション未登録駅では到着承認の時点で明確なエラーにする。

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

  if v_easy is null or v_normal is null or v_hard is null then
    raise exception 'この駅(id=%)にはEASY/NORMAL/HARDそれぞれ1件以上のミッションが登録されていません。管理画面から登録してください。', p_station_id;
  end if;

  select array_agg(x order by random()) into v_result from unnest(array[v_easy, v_normal, v_hard]) x;
  return v_result;
end;
$$;

-- fn_select_mission: NULLが渡された場合を明示的に拒否する
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
  if p_selected_mission_id is null then
    raise exception 'mission id is required';
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
  if v_offered is null or not (p_selected_mission_id = any (v_offered)) then
    raise exception 'mission not offered';
  end if;

  update team_mission_attempts
    set selected_mission_id = p_selected_mission_id, locked_at = now(), status = 'AWAITING_PHOTO'
    where id = p_attempt_id;
  update team_state set state = 'MISSION_ACTIVE', version = version + 1 where team_id = v_team_id;
end;
$$;
