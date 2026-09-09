-- 0093/0094の`SET LOCAL statement_timeout`によるフォールバックは機能していなかった
-- (Postgresのstatement_timeoutは「トップレベルSQL開始時点」のタイマーで確定し、
-- 関数内でSET LOCALしても実行中のクエリには反映されないため)。
--
-- 時間ベースの制御をやめ、「同じ駅を二度通らない単純経路」の探索を1深さずつ
-- 一時テーブルで進め、各深さの行数が上限(v_row_cap)を超えたら即座に打ち切って
-- relaxed(再訪を許す)探索へフォールバックする、行数ベースの確定的な安全策に
-- 書き換える。これにより実行時間・メモリ使用量ともに上限が保証される。
create or replace function fn_reachable_stations(p_start uuid, p_event_id uuid, p_n int, p_relaxed boolean)
returns table(station_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_row_cap constant int := 20000;
  v_depth int;
  v_count int;
  v_capped boolean := false;
begin
  if p_n <= 0 then
    return;
  end if;

  if not p_relaxed then
    create temporary table if not exists tmp_walk_cur (sid uuid, visited uuid[]) on commit drop;
    create temporary table if not exists tmp_walk_next (sid uuid, visited uuid[]) on commit drop;
    delete from tmp_walk_cur where true;
    insert into tmp_walk_cur values (p_start, array[p_start]);

    for v_depth in 1..p_n loop
      delete from tmp_walk_next where true;
      insert into tmp_walk_next (sid, visited)
        select nxt.other, w.visited || nxt.other
        from tmp_walk_cur w
        join lateral (
          select case when ed.station_a_id = w.sid then ed.station_b_id else ed.station_a_id end as other
          from edges ed
          where ed.event_id = p_event_id and ed.is_active and (ed.station_a_id = w.sid or ed.station_b_id = w.sid)
        ) nxt on true
        where not (nxt.other = any (w.visited));

      select count(*) into v_count from tmp_walk_next;
      if v_count > v_row_cap then
        v_capped := true;
        exit;
      end if;

      delete from tmp_walk_cur where true;
      insert into tmp_walk_cur select sid, visited from tmp_walk_next;

      if v_count = 0 then
        exit;
      end if;
    end loop;

    if not v_capped then
      return query select distinct sid from tmp_walk_cur;
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

-- 調査用に一時的に追加した関数を削除する。
drop function if exists fn_debug_timeout_test();
drop function if exists fn_debug_timeout_test2();
