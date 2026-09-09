-- 0088でeffect_value(dice_count)は更新したが、説明文(description)の数字を
-- 更新し忘れていたため修正する。

update cards set description = 'サイコロを4個振り、合計値を移動可能数とする。' where card_code = 'LIMITED_EXPRESS';
update cards set description = 'サイコロを5個振り、合計値を移動可能数とする。' where card_code = 'SHINKANSEN';
