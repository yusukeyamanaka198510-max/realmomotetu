-- ユーザー判断により「難易度チェンジカード」を不要と判断、無効化する。
update cards set enabled = false, updated_at = now() where card_code = 'DIFFICULTY_CHANGE';
