-- 0063の監査で漏れていた内部専用関数(いずれも読み取り専用/ガード関数で
-- クライアントから直接呼ぶ用途はないが、念のため同様にPUBLIC実行権限を剥奪する)
revoke execute on function fn_assert_event_active(uuid) from public;
revoke execute on function fn_reachable_stations(uuid, uuid, int, boolean) from public;
