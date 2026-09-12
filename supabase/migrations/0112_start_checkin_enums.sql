-- チームが自由に選んだスタート駅で、開始後に写真を提出して本部承認を得るまでの
-- 状態を表す値を追加する(enumへのadd valueは以後の参照と同一トランザクションにできないため
-- この値追加だけを単独のマイグレーションにする)。
alter type team_game_state add value 'START_CHECKIN' after 'WAITING';
alter type team_game_state add value 'START_CHECKIN_REVIEW' after 'START_CHECKIN';
alter type review_queue_type add value 'START_CHECKIN';
