-- 重大バグ修正: 「終了◯分前から非表示」の判定が now() < 閾値 のみだったため、
-- 一度隠れると終了後も永久に非表示のままになり、ゲーム終了後に優勝発表が誰にも見られない状態だった。
-- 「終了済みなら常に表示する」を優先するよう修正する。

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
    v_status in ('FORCE_ENDED', 'ENDED')
    or v_end_at is null
    or v_hide_minutes <= 0
    or now() < (v_end_at - make_interval(mins => v_hide_minutes))
    or now() >= v_end_at;

  if not v_visible then
    return jsonb_build_object('visible', false, 'rows', '[]'::jsonb);
  end if;

  select jsonb_agg(jsonb_build_object(
      'rank', ranked.rnk,
      'coin_balance_cache', ranked.coin_balance_cache,
      'team_name', case when ranked.team_id = v_team_id then ranked.team_name else null end,
      'is_mine', ranked.team_id = v_team_id
    ) order by ranked.rnk)
    into v_rows
  from (
    select ts.team_id, ts.coin_balance_cache, t.team_name,
      rank() over (order by ts.coin_balance_cache desc) as rnk
    from team_state ts
    join teams t on t.id = ts.team_id
    where ts.event_id = v_event_id
  ) ranked;

  return jsonb_build_object('visible', true, 'rows', coalesce(v_rows, '[]'::jsonb));
end;
$$;

create or replace function fn_get_goal_achievements()
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
    v_status in ('FORCE_ENDED', 'ENDED')
    or v_end_at is null
    or v_hide_minutes <= 0
    or now() < (v_end_at - make_interval(mins => v_hide_minutes))
    or now() >= v_end_at;

  if not v_visible then
    return jsonb_build_object('visible', false, 'rows', '[]'::jsonb);
  end if;

  select jsonb_agg(jsonb_build_object(
      'sequence_order', dq.sequence_order,
      'station_name', s.name,
      'team_name', t.team_name,
      'cleared_at', dq.cleared_at
    ) order by dq.sequence_order)
    into v_rows
  from destination_queue dq
  join stations s on s.id = dq.station_id
  left join teams t on t.id = dq.cleared_by_team_id
  where dq.event_id = v_event_id and dq.status = 'CLEARED';

  return jsonb_build_object('visible', true, 'rows', coalesce(v_rows, '[]'::jsonb));
end;
$$;
