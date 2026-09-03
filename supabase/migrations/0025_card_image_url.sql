-- カード画像を後から追加できるように、画像URL用のカラムだけ用意しておく(現時点では未設定でよい)。
alter table cards add column image_url text;
