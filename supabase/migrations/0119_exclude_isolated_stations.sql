-- 実データに、有効な接続(edge)を1本も持たない「孤立駅」が多数存在することが判明した
-- (路線データのインポート時にedgesが一部欠落していると見られる)。孤立駅がスタート駅や
-- ゴール候補に選ばれると、そのチームは以後サイコロを振っても移動先が0件になり詰む。
--
-- 根本的なデータ修正(edges補完)は別途行うとして、まずは「孤立駅を選択肢に出さない」
-- ようにする軽量RPCを用意する。

create or replace function fn_list_connected_stations()
returns table(id uuid, name text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name
  from stations s
  where s.event_id = current_event_id()
    and exists (
      select 1 from edges e
      where (e.station_a_id = s.id or e.station_b_id = s.id) and e.is_active
    );
$$;

grant execute on function fn_list_connected_stations() to authenticated;
