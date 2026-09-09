-- 絶好調カード(HOT_STREAK)は、新設した急行周遊カード(EXPRESS_LOOP)と全く同じ効果で
-- 紛らわしいため削除する。effect_type='HOT_STREAK'のディスパッチ処理自体は
-- 急行周遊カードが引き続き使うため残す。

delete from team_cards where card_id in (select id from cards where card_code = 'HOT_STREAK');
delete from card_usage_log where card_id in (select id from cards where card_code = 'HOT_STREAK');
update card_active_effects set source_card_id = null where source_card_id in (select id from cards where card_code = 'HOT_STREAK');
delete from station_card_pool where card_id in (select id from cards where card_code = 'HOT_STREAK');
delete from cards where card_code = 'HOT_STREAK';
