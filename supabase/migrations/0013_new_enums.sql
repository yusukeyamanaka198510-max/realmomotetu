-- Phase 8: 物件購入・カード取得・動的ゴール選定のための新enum値
-- ALTER TYPE ... ADD VALUE は同一トランザクション内でその値を使えないため、別マイグレーションに分離する。

alter type team_game_state add value 'PROPERTY_PURCHASE' after 'MISSION_REVIEW';
alter type coin_transaction_type add value 'PROPERTY_PURCHASE';
alter type coin_transaction_type add value 'PROPERTY_PAYOUT';
