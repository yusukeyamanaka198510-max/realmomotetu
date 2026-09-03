-- 40種のカードマスタを投入する。金額は既存のミッション経済スケール(万円・億円)に合わせて調整。

insert into cards (card_code, name, category, rarity, description, effect_type, effect_value, use_timing, target_type, usable_conditions, exchangeable) values
('EXPRESS', '急行カード', 'MOVEMENT', 'NORMAL', 'サイコロを2個振り、合計値を移動可能数とする。', 'MOVEMENT_DICE', '{"dice_count":2}', 'DICE_READY時', 'NONE', '{}', true),
('LIMITED_EXPRESS', '特急カード', 'MOVEMENT', 'RARE', 'サイコロを3個振り、合計値を移動可能数とする。', 'MOVEMENT_DICE', '{"dice_count":3}', 'DICE_READY時', 'NONE', '{}', true),
('SHINKANSEN', '新幹線カード', 'MOVEMENT', 'RARE', 'サイコロを4個振り、合計値を移動可能数とする。', 'MOVEMENT_DICE', '{"dice_count":4}', 'DICE_READY時', 'NONE', '{}', true),
('NOZOMI', 'のぞみカード', 'MOVEMENT', 'SUPER_RARE', 'サイコロを5個振り、合計値を移動可能数とする。', 'MOVEMENT_DICE', '{"dice_count":5}', 'DICE_READY時', 'NONE', '{}', true),
('ADVANCE_1', '1進めるカード', 'MOVEMENT', 'NORMAL', 'サイコロを振らず、必ず1駅進む。', 'MOVEMENT_FIXED', '{"steps":1}', 'DICE_READY時', 'NONE', '{}', true),
('ADVANCE_2', '2進めるカード', 'MOVEMENT', 'NORMAL', 'サイコロを振らず、必ず2駅進む。', 'MOVEMENT_FIXED', '{"steps":2}', 'DICE_READY時', 'NONE', '{}', true),
('ADVANCE_3', '3進めるカード', 'MOVEMENT', 'NORMAL', 'サイコロを振らず、必ず3駅進む。', 'MOVEMENT_FIXED', '{"steps":3}', 'DICE_READY時', 'NONE', '{}', true),
('ADVANCE_6', '6進めるカード', 'MOVEMENT', 'RARE', 'サイコロを振らず、必ず6駅進む。', 'MOVEMENT_FIXED', '{"steps":6}', 'DICE_READY時', 'NONE', '{}', true),
('LINEAR', 'リニアカード', 'MOVEMENT', 'SUPER_RARE', '現在地から接続可能なルート上で最大12駅まで移動できる(サイコロ不要)。', 'MOVEMENT_UPTO', '{"max_steps":12}', 'DICE_READY時', 'NONE', '{}', false),
('SURPRISE_JUMP', 'ぶっとびカード', 'MOVEMENT', 'RARE', '現在地とは別の駅からランダムに1駅を抽選し、そこへ移動する。', 'MOVEMENT_RANDOM_JUMP', '{}', 'DICE_READY時', 'NONE', '{}', true),
('DIRECT_TO_DESTINATION', '目的地直行カード', 'MOVEMENT', 'SUPER_RARE', '現在地から目的地までの最短距離が5駅以内の場合のみ使用可能。そのまま目的地へ移動する。', 'MOVEMENT_DIRECT_TO_DEST', '{"max_distance":5}', 'DICE_READY時', 'NONE', '{}', false),
('TELEPORT', 'テレポートカード', 'MOVEMENT', 'RARE', '他チームを1チーム選択し、そのチームが現在いる駅へ自チームを移動する。', 'MOVEMENT_TELEPORT_TO_TEAM', '{}', 'DICE_READY時', 'OTHER_TEAM', '{}', true),
('PROPERTY_JUMP', '物件飛びカード', 'MOVEMENT', 'RARE', '自チームが物件を所有している駅の中からランダムに1駅選び、その駅へ移動する。', 'MOVEMENT_TO_OWNED_PROPERTY', '{}', 'DICE_READY時', 'NONE', '{}', true),
('EXACT_FIT', 'ぴったりカード', 'MOVEMENT', 'RARE', '目的地までの最短距離が1〜6駅の場合に使用可能。そのまま目的地へ移動する。', 'MOVEMENT_DIRECT_TO_DEST', '{"min_distance":1,"max_distance":6}', 'DICE_READY時', 'NONE', '{}', true),

('SWAP_LOCATION', '場所がえカード', 'OBSTRUCTION', 'SUPER_RARE', '指定した他チームと現在地を交換する。', 'SWAP_LOCATION', '{}', 'DICE_READY時', 'OTHER_TEAM', '{}', false),
('SLOW_WALK', '牛歩カード', 'OBSTRUCTION', 'RARE', '指定チームの次回移動可能数を1駅固定にする。', 'FORCE_NEXT_MOVE_FIXED_1', '{}', 'いつでも', 'OTHER_TEAM', '{}', true),
('DICE_SEAL', 'サイコロ封印カード', 'OBSTRUCTION', 'RARE', '指定チームは次回移動時、移動系カードを使用できない。', 'BLOCK_NEXT_MOVEMENT_CARD', '{}', 'いつでも', 'OTHER_TEAM', '{}', true),
('STOPPED', '足止めカード', 'OBSTRUCTION', 'NORMAL', '指定チームは次回、その駅でミッションを1つ成功させるまで次の移動を開始できない。', 'BLOCK_UNTIL_MISSION_SUCCESS', '{}', 'いつでも', 'OTHER_TEAM', '{}', true),
('FART', 'オナラカード', 'OBSTRUCTION', 'RARE', '自チームと同じ駅にいる他チーム全てを、目的地から遠ざかる方向へ1〜3駅移動させる。', 'PUSH_BACK_SAME_STATION_TEAMS', '{}', 'いつでも', 'NONE', '{}', true),
('HIBERNATE', '冬眠カード', 'OBSTRUCTION', 'NORMAL', '指定チームは次回のカード使用権を失う。', 'BLOCK_NEXT_CARD_USE', '{}', 'いつでも', 'OTHER_TEAM', '{}', true),
('CARD_STEAL', '刀狩りカード', 'OBSTRUCTION', 'RARE', '指定チームの所持カードからランダムに1枚を自チームへ移動する。', 'STEAL_RANDOM_CARD', '{}', 'いつでも', 'OTHER_TEAM', '{}', true),
('DESTROY_CARD', '豪速球カード', 'OBSTRUCTION', 'RARE', '指定チームの所持カードからランダムに1枚を破棄する。', 'DESTROY_RANDOM_CARD', '{}', 'いつでも', 'OTHER_TEAM', '{}', true),
('COIN_ROB', '強奪カード', 'OBSTRUCTION', 'SUPER_RARE', '指定チームの現在所持コインの20%を自チームへ移動する。', 'STEAL_COIN_PERCENT', '{"percent":20}', 'いつでも', 'OTHER_TEAM', '{}', true),

('CARD_BARRIER', 'カードバリア', 'DEFENSE', 'RARE', '自チームに妨害系カードが使用された際、1回だけその効果を無効化する。', 'BARRIER', '{}', '所持しているだけで自動発動', 'SELF', '{}', false),

('MISSION_DOUBLE', 'ミッション倍増カード', 'MISSION', 'RARE', 'ミッション開始前に使用。そのミッションの獲得ポイントを2倍にする(5回ごとボーナスとは重複せず高い方を適用)。', 'MISSION_REWARD_MULTIPLIER', '{"multiplier":2}', 'ミッション選択〜挑戦中', 'SELF', '{}', true),
('MISSION_RETRY', 'ミッション再挑戦カード', 'MISSION', 'NORMAL', '失敗したミッションについて、同一駅で1回だけ別のミッションに挑戦し直せる。', 'MISSION_RESELECT_AFTER_FAILURE', '{}', 'ミッション失敗直後', 'SELF', '{}', true),
('DIFFICULTY_CHANGE', '難易度チェンジカード', 'MISSION', 'NORMAL', '提示されているミッションを実行開始前に再抽選する。', 'MISSION_REROLL_OFFERED', '{}', 'ミッション選択中', 'SELF', '{}', true),
('BONUS_MISSION', 'ボーナスミッションカード', 'MISSION', 'RARE', '通常ミッションとは別にボーナスミッションを1つ提示する。成功時のみ加算。', 'GRANT_BONUS_MISSION', '{}', 'ミッション選択中', 'SELF', '{}', true),

('YIELD_DOUBLE', '収益2倍カード', 'PROPERTY', 'RARE', '次回決算時、自チーム所有物件の決算収益を2倍にする。', 'PROPERTY_YIELD_X2', '{}', 'いつでも', 'SELF', '{}', true),
('HALF_PRICE', '半額カード', 'PROPERTY', 'NORMAL', '物件購入時に使用。その購入に限り価格を50%にする。', 'PROPERTY_HALF_PRICE', '{}', '物件購入時', 'SELF', '{}', true),
('TAKEOVER', '乗っ取りカード', 'PROPERTY', 'SUPER_RARE', '他チームが所有する物件1件を、通常価格を支払うことで自チームへ所有権を変更する。', 'PROPERTY_TAKEOVER', '{}', 'いつでも', 'OTHER_TEAM', '{}', false),

('CARD_TRADE', 'カード交換カード', 'SPECIAL', 'NORMAL', '他チームを指定し、両チームの所持カードからランダムに1枚ずつ交換する。', 'TRADE_RANDOM_CARD', '{}', 'いつでも', 'OTHER_TEAM', '{}', true),
('DEST_CHANGE', '目的地変更カード', 'SPECIAL', 'SUPER_RARE', '現在の目的地を破棄し、新しい目的地を再抽選する(直前と同じ駅は選ばない)。', 'DESTINATION_REROLL', '{}', 'いつでも', 'NONE', '{}', false),
('DEST_PREDICT', '目的地予想カード', 'SPECIAL', 'NORMAL', '次回目的地の候補を3駅表示する(確定ではなく参考情報)。', 'DESTINATION_PREDICT', '{"count":3}', 'いつでも', 'SELF', '{}', true),
('DEBT_FORGIVE', '徳政令カード', 'SPECIAL', 'NORMAL', 'マイナスコインを0に戻す(本ゲームにマイナスコインの概念が無いため現状無効)。', 'DEBT_FORGIVE', '{}', 'いつでも', 'NONE', '{}', true),
('SHARE', 'おすそわけカード', 'SPECIAL', 'NORMAL', '次に自チームが獲得したミッションポイントの50%相当を指定チームにも追加する(自チームの分は減らない)。', 'SHARE_NEXT_MISSION_REWARD', '{"percent":50}', 'いつでも', 'OTHER_TEAM', '{}', true),
('LOTTERY', '宝くじカード', 'SPECIAL', 'NORMAL', '使用時、抽選でコインを獲得する。', 'LOTTERY', '{"table":[{"amount":10000000,"weight":40},{"amount":20000000,"weight":30},{"amount":40000000,"weight":15},{"amount":60000000,"weight":10},{"amount":100000000,"weight":5}]}', 'いつでも', 'NONE', '{}', true),
('CARD_STATION', 'カード駅カード', 'SPECIAL', 'RARE', '使用するとランダムカードを2枚取得する。', 'DRAW_RANDOM_CARDS', '{"count":2}', 'いつでも', 'NONE', '{}', false),
('HOT_STREAK', '絶好調カード', 'SPECIAL', 'SUPER_RARE', '使用後3回の移動について、通常サイコロを2個振れる(移動カード使用時は消費しない)。', 'HOT_STREAK', '{"dice_count":2,"uses":3}', 'いつでも', 'SELF', '{}', true),
('VOUCHER', '引換券カード', 'SPECIAL', 'SUPER_RARE', 'カードマスタ内で交換対象として許可されたカードから、好きなカード1枚を選択して取得できる。', 'VOUCHER_EXCHANGE', '{}', 'いつでも', 'SELF', '{}', false);

-- 徳政令カード: マイナスコインの概念が本ゲームに存在しないため無効化しておく(仕様書の指示通り)
update cards set enabled = false where card_code = 'DEBT_FORGIVE';

-- 各イベントにレアリティ出現比率のデフォルト(NORMAL60/RARE30/SUPER_RARE10)を設定
insert into card_rarity_weights (event_id, rarity, weight)
select e.id, r.rarity, r.weight
from events e
cross join (values ('NORMAL', 60), ('RARE', 30), ('SUPER_RARE', 10)) as r(rarity, weight)
on conflict (event_id, rarity) do nothing;
