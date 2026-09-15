-- 緊急パフォーマンス対応(0117)で「直前駅に戻ることも含め、あらゆる経路での
-- 到達」を常に許可する実装に統一してしまったため、出目Nに対して「実質Nマス
-- 未満しか進んでいない駅」(直前駅への行き来を繰り返して足踏みした結果の駅)まで
-- 移動先の選択肢に出てしまっていた。本来は「直前に来た駅への即戻り」は
-- (行き止まり支線でやむを得ない場合を除き)禁止すべき。
--
-- 対応: p_relaxed=false(通常)では、0117と同じ「配列で駅集合だけを持ち回す」
-- 高速な方式のまま、各駅に「直前に来た駅」も一緒に持たせ、次の一歩でその駅へは
-- 戻れないようにする(行き止まり等でそれ以外に道が無ければ、その経路は自然に
-- 脱落するだけで、全体の計算が壊れることはない)。
-- p_relaxed=true(前者が0件だった場合のフォールバック)は0117のまま、
-- 直前駅への戻りも含めて許可する(「0件で詰む」事故を防ぐ最終手段として維持)。
--
-- どちらの方式も「各歩数ごとに存在しうる(駅, 直前駅)の組の集合」だけを持ち回す
-- ため、駅数×平均接続数のオーダーで収まり、0093以前の暴走(1行ごとに経路履歴を
-- 積み上げる方式)の再発はしない。

create or replace function fn_reachable_stations(p_start uuid, p_event_id uuid, p_n int, p_relaxed boolean)
returns table(station_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_depth int;
  v_frontier_prev uuid[];
  v_frontier_cur uuid[];
  v_next_prev uuid[];
  v_next_cur uuid[];
begin
  if p_n <= 0 or p_start is null then
    return;
  end if;

  if p_relaxed then
    v_frontier_cur := array[p_start];
    for v_depth in 1..p_n loop
      select array_agg(distinct nxt.other) into v_next_cur
      from unnest(v_frontier_cur) as f(sid)
      join lateral (
        select case when ed.station_a_id = f.sid then ed.station_b_id else ed.station_a_id end as other
        from edges ed
        where ed.event_id = p_event_id and ed.is_active and (ed.station_a_id = f.sid or ed.station_b_id = f.sid)
      ) nxt on true;

      if v_next_cur is null or array_length(v_next_cur, 1) = 0 then
        return;
      end if;
      v_frontier_cur := v_next_cur;
    end loop;

    return query select unnest(v_frontier_cur);
  else
    v_frontier_prev := array[null::uuid];
    v_frontier_cur := array[p_start];

    for v_depth in 1..p_n loop
      with expanded as (
        select distinct f.cur as new_prev, nxt.other as new_cur
        from unnest(v_frontier_prev, v_frontier_cur) as f(prev, cur)
        join lateral (
          select case when ed.station_a_id = f.cur then ed.station_b_id else ed.station_a_id end as other
          from edges ed
          where ed.event_id = p_event_id and ed.is_active and (ed.station_a_id = f.cur or ed.station_b_id = f.cur)
        ) nxt on true
        where f.prev is null or nxt.other is distinct from f.prev
      )
      select array_agg(new_prev), array_agg(new_cur) into v_next_prev, v_next_cur from expanded;

      if v_next_cur is null or array_length(v_next_cur, 1) = 0 then
        return;
      end if;
      v_frontier_prev := v_next_prev;
      v_frontier_cur := v_next_cur;
    end loop;

    return query select distinct unnest(v_frontier_cur);
  end if;
end;
$$;
