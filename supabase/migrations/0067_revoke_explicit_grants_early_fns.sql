-- fn_assert_event_active / fn_reachable_stations は初期(0007/0008)に作成された関数で、
-- PUBLIC経由の暗黙的な権限とは別に anon/authenticated への明示的なEXECUTE権限が
-- 付与されていた(おそらくプロジェクト初期構築時の一括grantによるもの)。
-- 0065のPUBLIC剥奪だけでは不十分だったため、明示的な権限も剥奪する。
revoke execute on function fn_assert_event_active(uuid) from authenticated, anon;
revoke execute on function fn_reachable_stations(uuid, uuid, int, boolean) from authenticated, anon;
