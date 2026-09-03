-- u14: 振り返り用に、本部が任意のタイミングで順位表のスナップショットを記録できるようにする。
-- 記録内容は本部のみ閲覧可能(参加者からは不可視)。

create table leaderboard_snapshots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  label text,
  taken_at timestamptz not null default now(),
  taken_by uuid references staff_users (id),
  rows jsonb not null
);
create index leaderboard_snapshots_event_idx on leaderboard_snapshots (event_id);

alter table leaderboard_snapshots enable row level security;

create policy leaderboard_snapshots_select on leaderboard_snapshots for select
  using (event_id = auth_staff_event_id());

create or replace function fn_take_leaderboard_snapshot(p_label text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid := auth_staff_event_id();
  v_rows jsonb;
  v_id uuid;
begin
  if v_event_id is null then
    raise exception 'staff only';
  end if;

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
    where ts.event_id = v_event_id
  ) ranked;

  insert into leaderboard_snapshots (event_id, label, taken_by, rows)
    values (v_event_id, nullif(trim(coalesce(p_label, '')), ''), auth.uid(), coalesce(v_rows, '[]'::jsonb))
    returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

grant execute on function fn_take_leaderboard_snapshot(text) to authenticated;

create or replace function fn_list_leaderboard_snapshots()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid := auth_staff_event_id();
  v_rows jsonb;
begin
  if v_event_id is null then
    raise exception 'staff only';
  end if;

  select jsonb_agg(jsonb_build_object(
      'id', ls.id, 'label', ls.label, 'taken_at', ls.taken_at, 'rows', ls.rows
    ) order by ls.taken_at desc)
    into v_rows
  from leaderboard_snapshots ls
  where ls.event_id = v_event_id;

  return coalesce(v_rows, '[]'::jsonb);
end;
$$;

grant execute on function fn_list_leaderboard_snapshots() to authenticated;
