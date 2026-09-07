-- 順位表で、ボンビーが取り憑いているチームが分かるようにマークを追加する。

create or replace function fn_get_leaderboard()
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
      'rank', ranked.rnk,
      'coin_balance_cache', ranked.coin_balance_cache,
      'team_name', ranked.team_name,
      'station_name', ranked.station_name,
      'has_bombii', ranked.has_bombii,
      'is_mine', ranked.team_id = v_team_id
    ) order by ranked.rnk)
    into v_rows
  from (
    select ts.team_id, ts.coin_balance_cache, t.team_name, s.name as station_name, ts.has_bombii,
      rank() over (order by ts.coin_balance_cache desc) as rnk
    from team_state ts
    join teams t on t.id = ts.team_id
    left join stations s on s.id = ts.current_station_id
    where ts.event_id = v_event_id
  ) ranked;

  return jsonb_build_object('visible', true, 'rows', coalesce(v_rows, '[]'::jsonb));
end;
$$;
