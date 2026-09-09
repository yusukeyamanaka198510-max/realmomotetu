-- 0097/0098の一時テーブル方式は、コネクションプーリングでバックエンドセッションが
-- 使い回されると、セッションに紐づく一時テーブルが呼び出しをまたいで残り続け、
-- DELETE(行削除)によるデッドタプルがtemp tableはautovacuum対象外のため溜まり続けて
-- 徐々に劣化する重大な問題があった(6000件の検証で後半どんどん遅くなり、
-- 5時間以上・エラー1807件という結果になった)。
--
-- テーブルI/Oを一切使わず、PL/pgSQL配列(uuid[])だけでBFSのフロンティアを
-- 保持する方式に書き直す。セッション状態に依存しないため、接続の使い回しに
-- 影響されず、常に同じ実行時間になる。
create or replace function fn_reachable_stations(p_start uuid, p_event_id uuid, p_n int, p_relaxed boolean)
returns table(station_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_row_cap constant int := 20000;
  v_depth int;
  v_cur_sid uuid[];
  v_cur_visited uuid[][];
  v_next_sid uuid[];
  v_next_visited uuid[][];
  v_count int;
  v_capped boolean := false;
  i int;
  v_edge record;
  v_other uuid;
  v_new_visited uuid[];
begin
  if p_n <= 0 then
    return;
  end if;

  if not p_relaxed then
    v_cur_sid := array[p_start];
    v_cur_visited := array[array[p_start]];

    for v_depth in 1..p_n loop
      v_next_sid := array[]::uuid[];
      v_next_visited := array[]::uuid[][];
      v_count := 0;

      for i in 1..coalesce(array_length(v_cur_sid, 1), 0) loop
        for v_edge in
          select case when ed.station_a_id = v_cur_sid[i] then ed.station_b_id else ed.station_a_id end as other
          from edges ed
          where ed.event_id = p_event_id and ed.is_active
            and (ed.station_a_id = v_cur_sid[i] or ed.station_b_id = v_cur_sid[i])
        loop
          v_other := v_edge.other;
          if not (v_other = any (v_cur_visited[i])) then
            v_count := v_count + 1;
            if v_count > v_row_cap then
              v_capped := true;
              exit;
            end if;
            v_new_visited := v_cur_visited[i] || v_other;
            v_next_sid := v_next_sid || v_other;
            v_next_visited := v_next_visited || array[v_new_visited];
          end if;
        end loop;
        exit when v_capped;
      end loop;
      exit when v_capped;

      v_cur_sid := v_next_sid;
      v_cur_visited := v_next_visited;

      if coalesce(array_length(v_cur_sid, 1), 0) = 0 then
        exit;
      end if;
    end loop;

    if not v_capped then
      return query select distinct unnest(v_cur_sid);
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
