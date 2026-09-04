-- ミッション成功後に「カードかコインか」を選ぶ新しい状態を追加する。
-- ALTER TYPE ... ADD VALUE は同一マイグレーション内でその値を使う関数定義と
-- 同時に実行できない(PostgreSQLの制約)ため、別マイグレーションに分ける。
alter type team_game_state add value 'MISSION_REWARD_CHOICE' after 'MISSION_REVIEW';
