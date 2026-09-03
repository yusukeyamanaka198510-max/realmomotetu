-- Phase 7 追加機能: 匿名ランキング表示・ゴール到達表示・終了間際の自動非表示

alter table events add column leaderboard_hide_minutes_before_end int not null default 0;

-- ===================== fn_get_leaderboard =====================
-- 参加者向け。自チームの行だけteam_nameが分かり、他は順位とコインのみ。
-- 終了時刻のhide_minutes前を過ぎると visible=false になり rows は空になる。

create or replace function fn_get_leaderboard()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_end_at timestamptz;
  v_hide_minutes int;
  v_visible boolean;
  v_rows jsonb;
begin
  if v_team_id is null then
    raise exception 'participant only';
  end if;

  select event_id into v_event_id from team_state where team_id = v_team_id;
  select end_at, leaderboard_hide_minutes_before_end into v_end_at, v_hide_minutes from events where id = v_event_id;

  v_visible := v_end_at is null or v_hide_minutes <= 0 or now() < (v_end_at - make_interval(mins => v_hide_minutes));

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

-- ===================== fn_get_goal_achievements =====================
-- 参加者向け。どのチームがどのゴール(目的地キューの順番)に到達したかを表示する。
-- 同じくhide_minutesの間際は非表示になる。

create or replace function fn_get_goal_achievements()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_end_at timestamptz;
  v_hide_minutes int;
  v_visible boolean;
  v_rows jsonb;
begin
  if v_team_id is null then
    raise exception 'participant only';
  end if;

  select event_id into v_event_id from team_state where team_id = v_team_id;
  select end_at, leaderboard_hide_minutes_before_end into v_end_at, v_hide_minutes from events where id = v_event_id;

  v_visible := v_end_at is null or v_hide_minutes <= 0 or now() < (v_end_at - make_interval(mins => v_hide_minutes));

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

-- ===================== 本部: 非表示タイミングの設定 =====================

create or replace function fn_admin_set_leaderboard_hide_minutes(p_minutes int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
begin
  if v_staff_event_id is null then
    raise exception 'staff only';
  end if;
  update events set leaderboard_hide_minutes_before_end = greatest(p_minutes, 0) where id = v_staff_event_id;

  insert into audit_log (event_id, staff_id, action_type, after_value)
    values (v_staff_event_id, auth.uid(), 'LEADERBOARD_HIDE_MINUTES_SET', jsonb_build_object('minutes', p_minutes));
end;
$$;

grant execute on function fn_get_leaderboard() to authenticated;
grant execute on function fn_get_goal_achievements() to authenticated;
grant execute on function fn_admin_set_leaderboard_hide_minutes(int) to authenticated;
