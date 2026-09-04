-- 移動グラフを辿る全関数に、0051で追加したedges.is_activeのフィルタを反映する。
-- ソフト除外された路線(JR・都営)のedgesは、これらの関数からは存在しないものとして扱われる。

create or replace function fn_reachable_stations(p_start uuid, p_event_id uuid, p_n int, p_relaxed boolean)
returns table(station_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  if p_n <= 0 then
    return;
  end if;

  if not p_relaxed then
    return query
      with recursive walk(sid, depth, visited) as (
        select p_start, 0, array[p_start]
        union all
        select nxt.other, w.depth + 1, w.visited || nxt.other
        from walk w
        join lateral (
          select case when ed.station_a_id = w.sid then ed.station_b_id else ed.station_a_id end as other
          from edges ed
          where ed.event_id = p_event_id and ed.is_active and (ed.station_a_id = w.sid or ed.station_b_id = w.sid)
        ) nxt on true
        where w.depth < p_n and not (nxt.other = any (w.visited))
      )
      select distinct sid from walk where depth = p_n;
  else
    return query
      with recursive walk(sid, depth) as (
        select p_start, 0
        union all
        select nxt.other, w.depth + 1
        from walk w
        join lateral (
          select case when ed.station_a_id = w.sid then ed.station_b_id else ed.station_a_id end as other
          from edges ed
          where ed.event_id = p_event_id and ed.is_active and (ed.station_a_id = w.sid or ed.station_b_id = w.sid)
        ) nxt on true
        where w.depth < p_n
      )
      select distinct sid from walk where depth = p_n;
  end if;
end;
$$;

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
    with recursive bfs(sid, depth, visited) as (
      select p_exclude_station_id, 0, array[p_exclude_station_id]
      union all
      select nxt.other, b.depth + 1, b.visited || nxt.other
      from bfs b
      join lateral (
        select case when ed.station_a_id = b.sid then ed.station_b_id else ed.station_a_id end as other
        from edges ed
        where ed.event_id = p_event_id and ed.is_active and (ed.station_a_id = b.sid or ed.station_b_id = b.sid)
      ) nxt on true
      where b.depth < v_min_distance and not (nxt.other = any (b.visited))
    )
    select array_agg(distinct sid) into v_near from bfs;
  end if;

  select id into v_next from stations
    where event_id = p_event_id and is_destination_candidate = true
      and id <> all (coalesce(v_excluded, array[]::uuid[]))
      and id <> all (coalesce(v_near, array[]::uuid[]))
      and (p_exclude_station_id is null or id <> p_exclude_station_id)
    order by random() limit 1;

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

create or replace function fn_shortest_hops(p_from uuid, p_to uuid, p_event_id uuid, p_max_depth int default 60)
returns int
language plpgsql stable security definer set search_path = public as $$
declare
  v_depth int;
begin
  if p_from = p_to then
    return 0;
  end if;
  with recursive bfs(sid, depth, visited) as (
    select p_from, 0, array[p_from]
    union all
    select nxt.other, b.depth + 1, b.visited || nxt.other
    from bfs b
    join lateral (
      select case when ed.station_a_id = b.sid then ed.station_b_id else ed.station_a_id end as other
      from edges ed
      where ed.event_id = p_event_id and ed.is_active and (ed.station_a_id = b.sid or ed.station_b_id = b.sid)
    ) nxt on true
    where b.depth < p_max_depth and not (nxt.other = any (b.visited))
  )
  select min(depth) into v_depth from bfs where sid = p_to;
  return v_depth;
end;
$$;

create or replace function fn_stations_within(p_from uuid, p_event_id uuid, p_max_depth int)
returns table(station_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  with recursive bfs(sid, depth, visited) as (
    select p_from, 0, array[p_from]
    union all
    select nxt.other, b.depth + 1, b.visited || nxt.other
    from bfs b
    join lateral (
      select case when ed.station_a_id = b.sid then ed.station_b_id else ed.station_a_id end as other
      from edges ed
      where ed.event_id = p_event_id and ed.is_active and (ed.station_a_id = b.sid or ed.station_b_id = b.sid)
    ) nxt on true
    where b.depth < p_max_depth and not (nxt.other = any (b.visited))
  )
  select distinct sid from bfs where depth > 0;
end;
$$;

create or replace function fn_station_distances_from(p_from uuid, p_max_depth int default 200)
returns table(station_id uuid, hops int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
  v_depth int := 0;
  v_frontier uuid[] := array[p_from];
  v_visited uuid[] := array[p_from];
  v_next uuid[];
  v_node uuid;
begin
  if v_team_id is null then
    raise exception 'participant only';
  end if;

  select event_id into v_event_id from team_state where team_id = v_team_id;
  if v_event_id is null then
    return;
  end if;

  station_id := p_from;
  hops := 0;
  return next;

  while array_length(v_frontier, 1) is not null and v_depth < p_max_depth loop
    select array_agg(distinct nxt.other)
      into v_next
    from unnest(v_frontier) as f(sid)
    join lateral (
      select case when ed.station_a_id = f.sid then ed.station_b_id else ed.station_a_id end as other
      from edges ed
      where ed.event_id = v_event_id and ed.is_active and (ed.station_a_id = f.sid or ed.station_b_id = f.sid)
    ) nxt on true
    where not (nxt.other = any (v_visited));

    exit when v_next is null;

    v_depth := v_depth + 1;
    v_visited := v_visited || v_next;

    foreach v_node in array v_next loop
      station_id := v_node;
      hops := v_depth;
      return next;
    end loop;

    v_frontier := v_next;
  end loop;
end;
$$;
