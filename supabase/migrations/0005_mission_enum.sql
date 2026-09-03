-- Phase 3: ミッション提示(未選択)状態を表すenum値を追加。
-- ALTER TYPE ... ADD VALUE は同一トランザクション内でその値を使えないため、別マイグレーションに分離する。
alter type mission_attempt_status add value 'OFFERED' before 'AWAITING_PHOTO';
