-- ゴール選定時、直前のゴールから近すぎる駅を除外するための最小距離設定を追加する。

alter table events add column min_destination_distance_hops int not null default 8;

create or replace function fn_pick_next_destination(p_event_id uuid, p_exclude_station_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_excluded uuid[];
  v_min_distance int;
  v_near uuid[];
  v_next uuid;
begin
  select array_agg(distinct x) into v_excluded from (
    select current_station_id as x from team_state where event_id = p_event_id and current_station_id is not null
    union
    select t.next_station_id as x from turns t
      join team_state ts on ts.team_id = t.team_id
      where ts.event_id = p_event_id and ts.current_turn_id = t.id and t.next_station_id is not null
  ) s;

  select min_destination_distance_hops into v_min_distance from events where id = p_event_id;

  if p_exclude_station_id is not null and v_min_distance > 0 then
    with recursive bfs(sid, depth) as (
      select p_exclude_station_id, 0
      union all
      select nxt.other, b.depth + 1
      from bfs b
      join lateral (
        select case when ed.station_a_id = b.sid then ed.station_b_id else ed.station_a_id end as other
        from edges ed
        where ed.event_id = p_event_id and (ed.station_a_id = b.sid or ed.station_b_id = b.sid)
      ) nxt on true
      where b.depth < v_min_distance and not exists (select 1 from bfs b2 where b2.sid = nxt.other)
    )
    select array_agg(distinct sid) into v_near from bfs;
  end if;

  select id into v_next from stations
    where event_id = p_event_id and is_destination_candidate = true
      and id <> all (coalesce(v_excluded, array[]::uuid[]))
      and id <> all (coalesce(v_near, array[]::uuid[]))
      and (p_exclude_station_id is null or id <> p_exclude_station_id)
    order by random() limit 1;

  -- 距離条件を満たす候補が無ければ、近さの制約だけ緩和して再抽選する(候補切れ防止)
  if v_next is null then
    select id into v_next from stations
      where event_id = p_event_id and is_destination_candidate = true
        and id <> all (coalesce(v_excluded, array[]::uuid[]))
        and (p_exclude_station_id is null or id <> p_exclude_station_id)
      order by random() limit 1;
  end if;

  return v_next;
end;
$$;
