-- 0049で意図した「古い1引数版オーバーロードの削除」が、マイグレーション追跡の都合上
-- 反映されていなかったため、あらためて別マイグレーションとして実行する。
drop function if exists fn_admin_start_event(int);
