-- 総合レビューで発見: fn_select_mission (過去のNULL検証修正で意図せず消えていた) と
-- fn_finish_property_purchase に、制限時間終了後の操作を止める fn_assert_event_active の
-- チェックが抜けていた。実際の報酬付与経路(fn_submit_mission_photos / fn_purchase_property等)
-- は正しくガードされているため実害は限定的だが、一貫性のため修正する。

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
  if v_team_id is null then
    raise exception 'participant only';
  end if;
  if p_selected_mission_id is null then
    raise exception 'mission id is required';
  end if;

  select ts.state, ts.event_id, a.offered_mission_ids, a.locked_at, a.team_id
    into v_state, v_event_id, v_offered, v_locked, v_attempt_team_id
    from team_state ts
    join team_mission_attempts a on a.id = p_attempt_id
    where ts.team_id = v_team_id
    for update of ts;

  perform fn_assert_event_active(v_event_id);

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

create or replace function fn_finish_property_purchase()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_state team_game_state;
begin
  if v_team_id is null then raise exception 'participant only'; end if;
  select state, event_id into v_state, v_event_id from team_state where team_id = v_team_id for update;
  perform fn_assert_event_active(v_event_id);
  if v_state <> 'PROPERTY_PURCHASE' then
    raise exception 'invalid state: %', v_state;
  end if;
  update team_state set state = 'DICE_READY', current_turn_id = null, version = version + 1 where team_id = v_team_id;
end;
$$;
