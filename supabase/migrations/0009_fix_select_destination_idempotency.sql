-- fn_select_destinationの二重実行防止バグ修正。
-- 従来は「state <> DESTINATION_SELECTION」を先に検査していたため、1回目の成功でstateが
-- TRAVELINGに変わった後の2回目の呼び出し(二重タップ等)が誤ってエラーになっていた。
-- 既に確定済み(destination_selectionsが存在する)かどうかを先に確認し、その場合は無害化する。

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
  if v_team_id is null then
    raise exception 'participant only';
  end if;

  select ts.state, ts.event_id, ts.current_turn_id into v_state, v_event_id, v_turn_id
    from team_state ts where ts.team_id = v_team_id for update;

  perform fn_assert_event_active(v_event_id);

  if v_turn_id is not null and exists (select 1 from destination_selections where turn_id = v_turn_id) then
    return;
  end if;

  if v_state <> 'DESTINATION_SELECTION' then
    raise exception 'invalid state: %', v_state;
  end if;

  select id into v_dice_roll_id from dice_rolls where turn_id = v_turn_id and is_valid order by rolled_at desc limit 1;
  select exists (
    select 1 from reachable_stations_snapshot where dice_roll_id = v_dice_roll_id and station_id = p_station_id
  ) into v_valid;
  if not v_valid then
    raise exception 'station not reachable';
  end if;

  insert into destination_selections (team_id, turn_id, dice_roll_id, selected_station_id, idempotency_key)
    values (v_team_id, v_turn_id, v_dice_roll_id, p_station_id, gen_random_uuid());
  update turns set next_station_id = p_station_id where id = v_turn_id;
  update team_state set state = 'TRAVELING', version = version + 1 where team_id = v_team_id;
end;
$$;
