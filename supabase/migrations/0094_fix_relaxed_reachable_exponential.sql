-- 0093で追加したtimeout-fallbackの検証中に判明: relaxed(同じ駅の再訪を許す)側の
-- 再帰CTEも、各深さで重複する(sid, depth)行を除去せずに次の深さへ展開していたため、
-- 深さ(n)が大きくなるにつれて行数が最大次数(8)のべき乗で増え続け、結局こちらも
-- 組合せ爆発してtimeoutする状態だった(n=30で2分以上応答なし)。
--
-- 対策: 再帰項で「1段階分の新しい行」を distinct してから積み上げる(标準的な
-- BFSレベルごとの重複排除)。これにより各深さで保持する行数は高々「駅数」件に
-- 収まり、全体の計算量は O(距離n × 駅数) の多項式時間になる。
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
      select distinct nxt.other, w.depth + 1
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
