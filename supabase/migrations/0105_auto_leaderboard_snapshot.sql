-- 順位表スナップショットを手動記録だけでなく、N分ごとに自動でも記録できるようにする。
-- 不動産の定期配当(fn_maybe_run_dividend_settlement)と同じ「ポーリングのたびに期限切れなら実行」方式。
alter table events add column if not exists leaderboard_snapshot_interval_minutes int not null default 0;
alter table events add column if not exists last_leaderboard_snapshot_at timestamptz;

-- ランキング集計とinsertの実処理を切り出す(スタッフ専用のfn_take_leaderboard_snapshotと、
-- チーム画面からのポーリングでも呼べるfn_maybe_take_leaderboard_snapshotの両方から使う)。
create or replace function fn_take_leaderboard_snapshot_core(p_event_id uuid, p_label text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_rows jsonb;
  v_id uuid;
begin
  select jsonb_agg(jsonb_build_object(
      'rank', ranked.rnk,
      'team_number', ranked.team_number,
      'team_name', ranked.team_name,
      'coin_balance_cache', ranked.coin_balance_cache,
      'current_station_name', ranked.current_station_name
    ) order by ranked.rnk)
    into v_rows
  from (
    select t.team_number, t.team_name, ts.coin_balance_cache, s.name as current_station_name,
      rank() over (order by ts.coin_balance_cache desc) as rnk
    from team_state ts
    join teams t on t.id = ts.team_id
    left join stations s on s.id = ts.current_station_id
    where ts.event_id = p_event_id
  ) ranked;

  insert into leaderboard_snapshots (event_id, label, taken_by, rows)
    values (p_event_id, nullif(trim(coalesce(p_label, '')), ''), auth.uid(), coalesce(v_rows, '[]'::jsonb))
    returning id into v_id;

  return v_id;
end;
$$;
revoke execute on function fn_take_leaderboard_snapshot_core(uuid, text) from public;

create or replace function fn_take_leaderboard_snapshot(p_label text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid := auth_staff_event_id();
  v_id uuid;
begin
  if v_event_id is null then
    raise exception 'staff only';
  end if;
  v_id := fn_take_leaderboard_snapshot_core(v_event_id, p_label);
  return jsonb_build_object('id', v_id);
end;
$$;
grant execute on function fn_take_leaderboard_snapshot(text) to authenticated;

create or replace function fn_maybe_take_leaderboard_snapshot()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_staff_event_id uuid := auth_staff_event_id();
  v_event_id uuid;
  v_interval_minutes int;
  v_last_run timestamptz;
begin
  if v_team_id is not null then
    select event_id into v_event_id from team_state where team_id = v_team_id;
  elsif v_staff_event_id is not null then
    v_event_id := v_staff_event_id;
  else
    return;
  end if;
  if v_event_id is null then
    return;
  end if;

  select leaderboard_snapshot_interval_minutes, last_leaderboard_snapshot_at
    into v_interval_minutes, v_last_run
    from events where id = v_event_id for update;

  if v_interval_minutes <= 0 then
    return;
  end if;
  if v_last_run is not null and now() - v_last_run < make_interval(mins => v_interval_minutes) then
    return;
  end if;

  perform fn_take_leaderboard_snapshot_core(v_event_id, '自動記録');
  update events set last_leaderboard_snapshot_at = now() where id = v_event_id;
end;
$$;
grant execute on function fn_maybe_take_leaderboard_snapshot() to authenticated;

create or replace function fn_admin_set_leaderboard_snapshot_interval(p_minutes int)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_staff_event_id uuid := auth_staff_event_id();
begin
  if v_staff_event_id is null then raise exception 'staff only'; end if;
  if p_minutes < 0 then raise exception 'minutes must be >= 0'; end if;
  update events set leaderboard_snapshot_interval_minutes = p_minutes where id = v_staff_event_id;
end;
$$;
grant execute on function fn_admin_set_leaderboard_snapshot_interval(int) to authenticated;
