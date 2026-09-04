-- 0044のfn_station_distances_frontで統計タイムアウト(exponential blowup)が発生したため修正。
-- 再帰CTEの「各経路が自分専用のvisited配列を持つ」方式は、同じ駅に複数の経路で
-- 何度も到達できてしまい(特にループ+支線が絡む山手線周辺で顕著)、経路数が指数的に
-- 増えてタイムアウトした。正しい単一始点BFSとして、深さごとのフロンティアと
-- 「イベント全体で共有される訪問済み集合」を使う反復方式に書き換える。

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
      where ed.event_id = v_event_id and (ed.station_a_id = f.sid or ed.station_b_id = f.sid)
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

grant execute on function fn_station_distances_from(uuid, int) to authenticated;
