-- u12: 各チームの現在地マップ用RPC。
-- team_stateは自チームのみ閲覧可能なRLSのため、他チームの現在駅を見るには
-- leaderboardと同様にsecurity definer関数を介し、他チームの名前は伏せて返す。
-- 表示可否(visible)もleaderboardと同じ非表示ウィンドウに合わせる(終盤の位置バレ防止)。

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
      'team_name', case when ts.team_id = v_team_id then t.team_name else null end,
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

grant execute on function fn_get_team_positions() to authenticated;
