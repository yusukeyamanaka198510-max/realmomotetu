-- 路線を「23区内の東京メトロのみ」に絞る(ソフト除外)。
-- JR・都営のedgesは削除せずis_active=falseにするだけなので、駅・ミッション・不動産・
-- カード駅別プールのデータはすべて残る。移動可能かどうかの判定だけがこのフラグに従う。

alter table edges add column if not exists is_active boolean not null default true;

update edges e
  set is_active = false
  from lines l
  where e.line_id = l.id and l.name not like '東京メトロ%';
