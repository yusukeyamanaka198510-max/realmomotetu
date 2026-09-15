-- 西武池袋線・西武新宿線を追加する(23区内区間のみ)。
--   西武池袋線: 池袋 〜 大泉学園(練馬区内)。次駅「保谷」から先は西東京市のため対象外。
--   西武新宿線: 西武新宿 〜 武蔵関(練馬区内)。次駅「東伏見」から先は西東京市のため対象外。
-- JRは今回対象外(ユーザー指示)。
--
-- 池袋・練馬・高田馬場・中井は既存駅(他路線で登録済み)のため乗換駅として接続するのみ。
-- それ以外の21駅は新規追加のため、EASY/NORMAL/HARD各1件ずつミッションを用意する
-- (特定の実在スポット名は裏取りできていないため、駅名標・改札・時刻表・駅前広場など
-- どの駅にも共通して存在する要素のみを使った安全な内容にしてある。本番までに
-- 現地を知るスタッフの方で内容の確認・差し替えをお願いします)。

do $$
declare
  v_event_id uuid;
  v_line_id uuid;
  v_names text[];
  v_ids uuid[];
  i int;
  v_id uuid;
  v_a uuid;
  v_b uuid;
begin
  for v_event_id in select id from events loop

    -- ===== 西武池袋線 =====
    v_names := array['池袋','椎名町','東長崎','江古田','桜台','練馬','中村橋','富士見台','練馬高野台','石神井公園','大泉学園'];

    select id into v_line_id from lines where event_id = v_event_id and name = '西武池袋線';
    if v_line_id is null then
      insert into lines (event_id, name) values (v_event_id, '西武池袋線') returning id into v_line_id;
    end if;

    v_ids := array[]::uuid[];
    for i in 1..array_length(v_names, 1) loop
      select id into v_id from stations where event_id = v_event_id and name = v_names[i];
      if v_id is null then
        insert into stations (event_id, name) values (v_event_id, v_names[i]) returning id into v_id;
      end if;
      v_ids := v_ids || v_id;
      insert into station_lines (station_id, line_id) values (v_id, v_line_id)
        on conflict (station_id, line_id) do nothing;
    end loop;

    for i in 1..array_length(v_ids, 1) - 1 loop
      v_a := v_ids[i]; v_b := v_ids[i + 1];
      if not exists (
        select 1 from edges
        where event_id = v_event_id and line_id = v_line_id
          and ((station_a_id = v_a and station_b_id = v_b) or (station_a_id = v_b and station_b_id = v_a))
      ) then
        insert into edges (event_id, station_a_id, station_b_id, line_id, is_active)
          values (v_event_id, v_a, v_b, v_line_id, true);
      end if;
    end loop;

    -- ===== 西武新宿線 =====
    v_names := array['西武新宿','高田馬場','下落合','中井','新井薬師前','沼袋','野方','都立家政','鷺ノ宮','下井草','井荻','上井草','上石神井','武蔵関'];

    select id into v_line_id from lines where event_id = v_event_id and name = '西武新宿線';
    if v_line_id is null then
      insert into lines (event_id, name) values (v_event_id, '西武新宿線') returning id into v_line_id;
    end if;

    v_ids := array[]::uuid[];
    for i in 1..array_length(v_names, 1) loop
      select id into v_id from stations where event_id = v_event_id and name = v_names[i];
      if v_id is null then
        insert into stations (event_id, name) values (v_event_id, v_names[i]) returning id into v_id;
      end if;
      v_ids := v_ids || v_id;
      insert into station_lines (station_id, line_id) values (v_id, v_line_id)
        on conflict (station_id, line_id) do nothing;
    end loop;

    for i in 1..array_length(v_ids, 1) - 1 loop
      v_a := v_ids[i]; v_b := v_ids[i + 1];
      if not exists (
        select 1 from edges
        where event_id = v_event_id and line_id = v_line_id
          and ((station_a_id = v_a and station_b_id = v_b) or (station_a_id = v_b and station_b_id = v_a))
      ) then
        insert into edges (event_id, station_a_id, station_b_id, line_id, is_active)
          values (v_event_id, v_a, v_b, v_line_id, true);
      end if;
    end loop;

  end loop;
end $$;

-- ===================== 新規21駅のミッション(EASY/NORMAL/HARD 各1件) =====================
-- 駅名標・改札・時刻表・路線図・駅前広場など、どの駅にも共通して存在する要素のみを使用。

insert into station_missions (station_id, difficulty, title, description)
select s.id, x.difficulty::mission_difficulty,
  format(x.title_fmt, s.name),
  format(x.desc_fmt, s.name)
from stations s
cross join (values
  ('EASY', '%sミッション(易)',
   '駅名『%s』がはっきり読める駅入口・駅名標を背景に、4人で肩を組んで横一列に並んだ写真を撮れ。' || chr(10) ||
   '【判定基準】駅名が読める／チーム4人全員が写る'),
  ('NORMAL', '%sミッション(中)',
   '『%s』の改札または時刻表・路線図が判別できる構図で、4人全員が同じ方向を指差すポーズで撮れ。' || chr(10) ||
   '【判定基準】改札または時刻表・路線図と判別できる／チーム4人全員が写る'),
  ('HARD', '%sミッション(難)',
   '『%s』の駅前(ロータリーまたは駅前広場)だと分かる構図に、4人で電車のドアが閉まる合図のジェスチャー(両手を顔の前で合わせる)を入れて撮れ。' || chr(10) ||
   '【判定基準】駅前だと分かる／4人全員／指定アクションが成立')
) as x(difficulty, title_fmt, desc_fmt)
where s.name in (
  '椎名町','東長崎','江古田','桜台','中村橋','富士見台','練馬高野台','石神井公園','大泉学園',
  '西武新宿','下落合','新井薬師前','沼袋','野方','都立家政','鷺ノ宮','下井草','井荻','上井草','上石神井','武蔵関'
)
and not exists (
  select 1 from station_missions sm
  where sm.station_id = s.id and sm.difficulty = x.difficulty::mission_difficulty
);
