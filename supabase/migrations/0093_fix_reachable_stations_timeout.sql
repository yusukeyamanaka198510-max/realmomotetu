-- fn_reachable_stations(p_relaxed=false)は「同じ駅を二度通らない単純経路」を
-- 全列挙する実装のため、乗り換えの多い地域を経由する駅では経路の組み合わせが
-- 組合せ爆発し、statement timeoutで失敗することが検証(全251駅×距離1-42)で
-- 判明した(106駅で発生、本番当日のダイス移動でいつでも起こりうる)。
--
-- 対策: 厳密探索に短い statement_timeout を設定し、タイムアウトした場合は
-- 呼び出し側が「候補0件」の時に既に使っている relaxed(同じ駅の再訪を許す)
-- 探索へその場でフォールバックする。relaxedの探索は各深さの到達可能駅集合を
-- 再訪込みで計算するだけなので多項式時間で必ず高速に終わる。
create or replace function fn_reachable_stations(p_start uuid, p_event_id uuid, p_n int, p_relaxed boolean)
returns table(station_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_saved_timeout text;
begin
  if p_n <= 0 then
    return;
  end if;

  if not p_relaxed then
    v_saved_timeout := current_setting('statement_timeout');
    begin
      set local statement_timeout = '3s';
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
      execute format('set local statement_timeout = %L', v_saved_timeout);
      return;
    exception when query_canceled then
      execute format('set local statement_timeout = %L', v_saved_timeout);
      -- 単純経路の組合せ爆発によるタイムアウト。relaxed探索にフォールバックする。
    end;
  end if;

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
end;
$$;
