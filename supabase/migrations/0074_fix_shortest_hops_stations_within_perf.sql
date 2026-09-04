-- fn_shortest_hops / fn_stations_within は「経路ごとに訪問済み配列を引き回す」再帰CTEのままだったため、
-- 実際の駅グラフでは組み合わせ爆発してタイムアウトすることが判明した(0045でfn_station_distances_fromに
-- 適用したのと同じ修正を、ここでも反復フロンティアBFS方式に置き換えて適用する)。
-- ボンビー機能がfn_shortest_hopsをゴール到着のたびに呼ぶため、本番投入前に必ず直す必要がある。

create or replace function fn_shortest_hops(p_from uuid, p_to uuid, p_event_id uuid, p_max_depth int default 60)
returns int
language plpgsql stable security definer set search_path = public as $$
declare
  v_depth int := 0;
  v_frontier uuid[] := array[p_from];
  v_visited uuid[] := array[p_from];
  v_next uuid[];
begin
  if p_from = p_to then
    return 0;
  end if;

  while array_length(v_frontier, 1) is not null and v_depth < p_max_depth loop
    select array_agg(distinct nxt.other)
      into v_next
    from unnest(v_frontier) as f(sid)
    join lateral (
      select case when ed.station_a_id = f.sid then ed.station_b_id else ed.station_a_id end as other
      from edges ed
      where ed.event_id = p_event_id and ed.is_active and (ed.station_a_id = f.sid or ed.station_b_id = f.sid)
    ) nxt on true
    where not (nxt.other = any (v_visited));

    exit when v_next is null;

    v_depth := v_depth + 1;
    if p_to = any (v_next) then
      return v_depth;
    end if;

    v_visited := v_visited || v_next;
    v_frontier := v_next;
  end loop;

  return null;
end;
$$;

create or replace function fn_stations_within(p_from uuid, p_event_id uuid, p_max_depth int)
returns table(station_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  v_depth int := 0;
  v_frontier uuid[] := array[p_from];
  v_visited uuid[] := array[p_from];
  v_next uuid[];
  v_node uuid;
begin
  station_id := p_from;
  return next;

  while array_length(v_frontier, 1) is not null and v_depth < p_max_depth loop
    select array_agg(distinct nxt.other)
      into v_next
    from unnest(v_frontier) as f(sid)
    join lateral (
      select case when ed.station_a_id = f.sid then ed.station_b_id else ed.station_a_id end as other
      from edges ed
      where ed.event_id = p_event_id and ed.is_active and (ed.station_a_id = f.sid or ed.station_b_id = f.sid)
    ) nxt on true
    where not (nxt.other = any (v_visited));

    exit when v_next is null;

    v_depth := v_depth + 1;
    v_visited := v_visited || v_next;

    foreach v_node in array v_next loop
      station_id := v_node;
      return next;
    end loop;

    v_frontier := v_next;
  end loop;
end;
$$;
