-- セキュリティ修正(0056/0057で見つかった問題の続き): このプロジェクトではPostgresの
-- デフォルト特権により、明示的にgrant executeしていない関数もauthenticated/anonから
-- 直接呼び出せてしまう。「他の関数から内部的にperformされるだけの想定」で
-- 明示的なgrantを付けていなかった以下の関数は、任意の引数で直接叩けると実害が大きいため、
-- 実行権限を明示的に剥奪する。
--
-- 特に深刻だったもの:
--   fn_grant_card: 任意のteam_id・card_id・数量でカードを無料付与できてしまう
--   fn_finalize_movement: 実際のダイス目やreachable計算を無視し、任意駅への移動を
--     DESTINATION_SELECTIONとして確定できてしまう(事実上のテレポート)
--   fn_try_consume_barrier: 他チームのバリアカードを勝手に消費させられる
--   fn_notify_team: 任意のチームへ任意メッセージを送りつけられる
-- 読み取り専用で実害の小さいもの(fn_generate_offered_missions/fn_pick_easy_mission/
-- fn_draw_weighted_card)も、多層防御のため合わせて剥奪する。

revoke execute on function fn_grant_card(uuid, uuid, int) from authenticated, anon;
revoke execute on function fn_finalize_movement(uuid, uuid[], int, int[], int, uuid, boolean) from authenticated, anon;
revoke execute on function fn_try_consume_barrier(uuid) from authenticated, anon;
revoke execute on function fn_notify_team(uuid, uuid, text, uuid) from authenticated, anon;
revoke execute on function fn_generate_offered_missions(uuid, uuid) from authenticated, anon;
revoke execute on function fn_pick_easy_mission(uuid, uuid) from authenticated, anon;
revoke execute on function fn_draw_weighted_card(uuid, uuid, uuid[]) from authenticated, anon;
