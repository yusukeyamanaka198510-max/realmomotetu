-- fn_reachable_stations の revisit許可(relaxed)モードを修正。
--
-- 問題: これまでのrelaxedモードは、各歩数で「経路の履歴(visited)」を持ったまま
-- recursive CTEで再帰していた。同じ駅を何度通ってもよい(revisit許可)ため、
-- 接続数の多い実データ(本物の東京の駅網)では経路の組合せが歩数に対して
-- 指数的に増え、行数が膨大になって正しく結果を返せなくなっていた
-- (テスト用の簡易路線網では接続数が少なく、この問題が表面化しなかった)。
--
-- 修正: revisit許可モードでは経路の履歴を持つ必要が無い(同じ駅を何度通ってもよいので、
-- 「今どの駅の集合にいるか」だけが分かれば十分)。各歩数ごとに「到達しうる駅の集合
-- (重複なし)」だけを次の歩数に持ち回す方式に書き換える。これなら集合のサイズは
-- 駅の総数を超えないため、組合せ爆発が起こり得ない。

create or replace function fn_reachable_stations(p_start uuid, p_event_id uuid, p_n int, p_relaxed boolean)
returns table(station_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_row_cap constant int := 20000;
  v_depth int;
  v_cur walk_state[];
  v_next walk_state[];
  v_count int;
  v_capped boolean := false;
  v_state walk_state;
  v_edge record;
  v_other uuid;
  v_frontier uuid[];
  v_next_frontier uuid[];
begin
  if p_n <= 0 then
    return;
  end if;

  if not p_relaxed then
    v_cur := array[row(p_start, array[p_start])::walk_state];

    for v_depth in 1..p_n loop
      v_next := array[]::walk_state[];
      v_count := 0;

      foreach v_state in array v_cur loop
        for v_edge in
          select case when ed.station_a_id = v_state.sid then ed.station_b_id else ed.station_a_id end as other
          from edges ed
          where ed.event_id = p_event_id and ed.is_active
            and (ed.station_a_id = v_state.sid or ed.station_b_id = v_state.sid)
        loop
          v_other := v_edge.other;
          if not (v_other = any (v_state.visited)) then
            v_count := v_count + 1;
            if v_count > v_row_cap then
              v_capped := true;
              exit;
            end if;
            v_next := v_next || row(v_other, v_state.visited || v_other)::walk_state;
          end if;
        end loop;
        exit when v_capped;
      end loop;
      exit when v_capped;

      v_cur := v_next;

      if coalesce(array_length(v_cur, 1), 0) = 0 then
        exit;
      end if;
    end loop;

    if not v_capped then
      return query select distinct ws.sid from unnest(v_cur) as ws;
      return;
    end if;
    -- 単純経路の組合せ爆発で行数上限に達した。relaxed探索にフォールバックする。
  end if;

  -- revisit許可(relaxed): 経路履歴を持たず、各歩数の「到達しうる駅の集合」だけを持ち回す。
  v_frontier := array[p_start];
  for v_depth in 1..p_n loop
    select array_agg(distinct nxt.other) into v_next_frontier
    from unnest(v_frontier) as f(sid)
    join lateral (
      select case when ed.station_a_id = f.sid then ed.station_b_id else ed.station_a_id end as other
      from edges ed
      where ed.event_id = p_event_id and ed.is_active and (ed.station_a_id = f.sid or ed.station_b_id = f.sid)
    ) nxt on true;

    if v_next_frontier is null or array_length(v_next_frontier, 1) = 0 then
      return;
    end if;
    v_frontier := v_next_frontier;
  end loop;

  return query select unnest(v_frontier);
end;
$$;
