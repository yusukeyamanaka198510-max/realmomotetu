-- 0024で追加した team_cards_select_event は、実際にはどの機能(刀狩り・豪速球・カード交換は
-- いずれもサーバー側でランダム選択するためクライアントが相手の手札を知る必要が無い)からも
-- 参照されておらず、単に「他チームが今何のカードを何枚持っているか」を全チームに公開して
-- しまう不要な情報漏洩だった。競技性のあるゲームなので削除し、自チーム/本部のみ閲覧可能に戻す。
-- (team_property_purchases_select_event は乗っ取りカードの対象選択UIで実際に使用しているため維持)

drop policy if exists team_cards_select_event on team_cards;
