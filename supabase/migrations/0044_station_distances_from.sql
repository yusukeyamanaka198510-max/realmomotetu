-- 移動先選択画面で「(現在設定されている)ゴールまで何マスか」を各候補駅に表示するため、
-- 1回のBFSで指定駅からイベント内の全駅までの最短ホップ数をまとめて返す。
-- fn_shortest_hops/fn_stations_within(0021)と同じBFSパターンだが、候補駅ぶん何度も
-- 呼び出す必要がないよう単一クエリで全駅ぶんの距離を返す点が異なる。
-- event_idはクライアントから受け取らず、呼び出したチーム自身の所属イベントから導出する
-- (fn_get_leaderboard等と同じ方針。他イベントのデータを覗けないようにするため)。

create or replace function fn_station_distances_from(p_from uuid, p_max_depth int default 200)
returns table(station_id uuid, hops int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_team_id uuid := auth_team_id();
  v_event_id uuid;
begin
  if v_team_id is null then
    raise exception 'participant only';
  end if;

  select event_id into v_event_id from team_state where team_id = v_team_id;
  if v_event_id is null then
    return;
  end if;

  return query
  with recursive bfs(sid, depth, visited) as (
    select p_from, 0, array[p_from]
    union all
    select nxt.other, b.depth + 1, b.visited || nxt.other
    from bfs b
    join lateral (
      select case when ed.station_a_id = b.sid then ed.station_b_id else ed.station_a_id end as other
      from edges ed
      where ed.event_id = v_event_id and (ed.station_a_id = b.sid or ed.station_b_id = b.sid)
    ) nxt on true
    where b.depth < p_max_depth and not (nxt.other = any (b.visited))
  )
  select bfs.sid, min(bfs.depth)::int from bfs group by bfs.sid;
end;
$$;

grant execute on function fn_station_distances_from(uuid, int) to authenticated;
