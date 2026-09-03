-- 同一駅3回目以降到着時の一律ボーナス用トランザクション種別を追加する。
-- (enum への値追加は既存のトランザクションと同一マイグレーション内で使えないため、別ファイルに分離)

alter type coin_transaction_type add value 'REPEAT_VISIT_BONUS';
