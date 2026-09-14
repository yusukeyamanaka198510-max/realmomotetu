-- 緊急対応: fn_reachable_stations の「同じ駅を通らない経路」探索(非relaxedモード)が、
-- 1行ごとにPL/pgSQLの手続き型ループでDBへ細かいクエリを大量発行する実装になっており、
-- 接続数の多い実データ(本物の駅網)では非常に重く、複数チーム同時のサイコロ操作で
-- DB全体を詰まらせて本部画面(認証まわりのmiddleware)まで巻き添えでタイムアウトしていた。
--
-- 対応: 0116で作った「各歩数ごとに到達しうる駅の集合(重複なし)だけを持ち回す」
-- 高速な方式(フロンティア探索)に、非relaxedモードも含めて完全に統一する。
-- 「同じ駅を通らない経路のみ」という制約は無くなり、実質revisit許可のみになる
-- (歩数分の移動先候補が、行ったり来たりする経路も含めて求まる)。
-- ゲームバランス上、経路制約を厳密に復活させたい場合は後日改めて最適化した
-- SQLで実装すること。

create or replace function fn_reachable_stations(p_start uuid, p_event_id uuid, p_n int, p_relaxed boolean)
returns table(station_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_depth int;
  v_frontier uuid[];
  v_next_frontier uuid[];
begin
  if p_n <= 0 or p_start is null then
    return;
  end if;

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
