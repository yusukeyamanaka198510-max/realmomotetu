-- 0099で`uuid[][]`(2次元配列)の行アクセスにop ANY/ALLを使おうとして
-- 「array on right side」エラーになった(Postgresの多次元配列は単純な[i]で
-- 1次元配列を取り出せない)。複合型を定義し、その配列として持つ方式に修正する。
create type walk_state as (sid uuid, visited uuid[]);

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
