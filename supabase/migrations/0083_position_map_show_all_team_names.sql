-- 方針変更: 現在地マップで自チーム以外のチーム名を非表示にしていたが、
-- 順位表と同様、ユーザーからの要望により全チーム名を表示する。

create or replace function fn_get_team_positions()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_end_at timestamptz;
  v_hide_minutes int;
  v_status event_status;
  v_visible boolean;
  v_rows jsonb;
begin
  if v_team_id is null then
    raise exception 'participant only';
  end if;

  select event_id into v_event_id from team_state where team_id = v_team_id;
  select end_at, leaderboard_hide_minutes_before_end, status into v_end_at, v_hide_minutes, v_status from events where id = v_event_id;

  v_visible :=
    v_status not in ('FORCE_ENDED', 'ENDED')
    and (v_end_at is null or now() < v_end_at)
    and (v_hide_minutes <= 0 or v_end_at is null or now() < (v_end_at - make_interval(mins => v_hide_minutes)));

  if not v_visible then
    return jsonb_build_object('visible', false, 'rows', '[]'::jsonb);
  end if;

  select jsonb_agg(jsonb_build_object(
      'is_mine', ts.team_id = v_team_id,
      'team_name', t.team_name,
      'current_station_id', ts.current_station_id,
      'next_station_id', tu.next_station_id,
      'state', ts.state
    ))
    into v_rows
  from team_state ts
  join teams t on t.id = ts.team_id
  left join turns tu on tu.id = ts.current_turn_id
  where ts.event_id = v_event_id and ts.current_station_id is not null;

  return jsonb_build_object('visible', true, 'rows', coalesce(v_rows, '[]'::jsonb));
end;
$$;
