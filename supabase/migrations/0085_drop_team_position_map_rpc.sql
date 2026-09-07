-- 参加者画面の「各チームの現在地マップ」を廃止(順位表の駅名表示に統合したため)。
-- 使われなくなったRPCを削除する。

drop function if exists fn_get_team_positions();
