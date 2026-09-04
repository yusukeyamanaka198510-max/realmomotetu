-- 追加の全件監査(has_function_privilege による実際のACL照会)で発見した、
-- クライアントから直接呼ぶ用途のない読み取り専用グラフ関数。
-- (fn_station_distances_from は src/app/team/page.tsx から直接呼ばれているため対象外)
revoke execute on function fn_pick_next_destination(uuid, uuid) from public, authenticated, anon;
revoke execute on function fn_shortest_hops(uuid, uuid, uuid, int) from public, authenticated, anon;
revoke execute on function fn_stations_within(uuid, uuid, int) from public, authenticated, anon;
