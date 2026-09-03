-- カード機能追加に伴うenum値の追加(既存トランザクションと分離するため専用ファイル)。

alter type coin_transaction_type add value 'CARD_EFFECT';
alter type review_queue_type add value 'BONUS_MISSION';
