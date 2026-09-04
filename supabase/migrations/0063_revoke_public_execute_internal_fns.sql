-- 根本原因: PostgreSQLは関数作成時にデフォルトでPUBLICロールにEXECUTE権限を自動付与する
-- (テーブルとは異なる挙動)。authenticated/anonは明示的な権限を持っていなくても、
-- 全ロールが暗黙にPUBLICのメンバーであるため実行できてしまっていた。
-- 0058/0061での "revoke ... from authenticated, anon" は的外れで、
-- 実際に必要だったのは "revoke ... from public"。
revoke execute on function fn_grant_card(uuid, uuid, int) from public;
revoke execute on function fn_finalize_movement(uuid, uuid[], int, int[], int, uuid, boolean) from public;
revoke execute on function fn_try_consume_barrier(uuid) from public;
revoke execute on function fn_notify_team(uuid, uuid, text, uuid) from public;
revoke execute on function fn_generate_offered_missions(uuid, uuid) from public;
revoke execute on function fn_pick_easy_mission(uuid, uuid) from public;
revoke execute on function fn_draw_weighted_card(uuid, uuid, uuid[]) from public;
