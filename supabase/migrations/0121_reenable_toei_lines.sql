-- 確認クエリの結果、都営線(浅草線・三田線・新宿線・大江戸線×2)は既にデータとして
-- 投入済みだったが、migration 0051(メトロのみに限定)によりJR同様に無効化された
-- ままだったことが判明した。ユーザーの意向により、都営線は有効化する(JRは対象外)。
--
-- あわせて、都営線・東京メトロ有楽町線に含まれる「市ケ谷」駅が、mission-master.json側の
-- 表記「市ヶ谷」(小さい「ヶ」)とズレていたために、この駅にだけミッションが1件も
-- 登録されていないことが判明した(有楽町線は元々有効なため、この駅は既に本番でも
-- 到達可能で、ミッションが無いとチームが詰む状態だった)。同内容のミッションを
-- 「市ケ谷」表記でも登録する。

update edges e
  set is_active = true
  from lines l
  where e.line_id = l.id and l.name like '都営%';

insert into station_missions (station_id, difficulty, title, description)
select s.id, x.difficulty::mission_difficulty, x.title, x.description
from stations s
cross join (values
  ('EASY', '市ケ谷ミッション(易)',
   '駅名『市ケ谷』がはっきり読める駅入口・駅名標を背景に、1人が先生、3人が授業を受けるポーズでチーム4人全員が写った写真を撮れ。' || chr(10) ||
   '【判定基準】駅名が読める／チーム4人全員が写る'),
  ('NORMAL', '市ケ谷ミッション(中)',
   '駅周辺の『市ケ谷フィッシュセンター・外濠』を見つけ、場所が判別できる名称表示または特徴的な外観と、チーム4人全員を1枚に収めて撮れ。' || chr(10) ||
   '【判定基準】『市ケ谷フィッシュセンター・外濠』と判別できる／チーム4人全員が写る'),
  ('HARD', '市ケ谷ミッション(難)',
   '『市ケ谷フィッシュセンター・外濠』だと分かる橋・川・運河の要素と水面を入れ、4人で横一列に大きな"波"の形を作って撮れ。' || chr(10) ||
   '【判定基準】『市ケ谷フィッシュセンター・外濠』と判別できる／4人全員／指定アクションが成立')
) as x(difficulty, title, description)
where s.name = '市ケ谷'
  and not exists (
    select 1 from station_missions sm
    where sm.station_id = s.id and sm.difficulty = x.difficulty::mission_difficulty
  );
