-- ボーナスミッションカードの内容重複を解決する。
-- 各駅の通常ミッションは易/中/難の3つしか無く、通常フローで使い切ってしまうため、
-- ボーナスミッションは「駅の実在ランドマーク」に依存しない汎用チャレンジのプールから
-- 選ぶ方式に変更する(どの駅でも成立する内容なので、通常ミッションと重複しない)。

create table bonus_mission_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  reward bigint not null default 15000000,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table bonus_mission_templates enable row level security;
grant select on bonus_mission_templates to authenticated;
grant insert, update, delete on bonus_mission_templates to authenticated;

create policy bonus_mission_templates_select on bonus_mission_templates for select using (true);
create policy bonus_mission_templates_staff_write on bonus_mission_templates for all to authenticated
  using (auth_staff_event_id() is not null) with check (auth_staff_event_id() is not null);

insert into bonus_mission_templates (title, description, reward) values
('ボーナス: 改札タッチ', '駅の自動改札(またはICカードタッチ部分)を背景に、4人全員が同時にタッチするポーズで1枚。', 15000000),
('ボーナス: 時刻表ポーズ', '駅の時刻表または発車標を指差しながら、4人全員が驚いた顔で1枚。', 15000000),
('ボーナス: 階段一列', '階段またはエスカレーターで4人が縦一列に並んだ写真を1枚。', 15000000),
('ボーナス: 自販機乾杯', '駅構内・駅前の自動販売機の前で、4人が缶や飲み物で乾杯するポーズを1枚。', 15000000),
('ボーナス: 駅名標ジャンプ', '駅名標が読める場所で、4人全員がジャンプした瞬間の写真を1枚。', 15000000),
('ボーナス: 点字ブロック整列', 'ホームの黄色い点字ブロックに沿って、4人が横一列に並んだ写真を1枚(電車の進路は塞がないこと)。', 15000000),
('ボーナス: ロータリー集合', '駅前のロータリーまたはバス乗り場を背景に、4人全員で決めポーズを1枚。', 15000000),
('ボーナス: コインロッカー前ガッツポーズ', 'コインロッカーの前で、4人全員がガッツポーズをしている写真を1枚。', 15000000),
('ボーナス: 案内板指差し', '駅構内の案内板・地図の前で、4人のうち1人が案内板を指差し、残り3人が覗き込むポーズで1枚。', 15000000),
('ボーナス: 花壇・植え込み集合', '駅周辺の花壇や植え込みを背景に、4人全員が笑顔で並んだ写真を1枚。', 15000000),
('ボーナス: エレベーター前ポーズ', 'エレベーターまたは多目的トイレの案内サインの前で、4人全員で敬礼ポーズを1枚。', 15000000),
('ボーナス: 出口番号タッチ', '駅の出口番号標識(◯番出口)にタッチしている4人全員が写った写真を1枚。', 15000000);

-- ===================== team_bonus_mission_attempts: 内容を直接保持する形に変更 =====================
-- station_missions を参照する設計だと「駅固有ランドマーク」前提の内容しか選べないため、
-- 汎用チャレンジの内容(title/description)をそのまま複製して保持する方式に変更する。

alter table team_bonus_mission_attempts drop constraint if exists team_bonus_mission_attempts_mission_id_fkey;
alter table team_bonus_mission_attempts alter column mission_id drop not null;
alter table team_bonus_mission_attempts add column title text;
alter table team_bonus_mission_attempts add column description text;
