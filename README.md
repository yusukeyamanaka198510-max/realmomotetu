# リアル桃鉄 v1

リアルイベント用ゲーム進行管理Webアプリ。Next.js (App Router) + Supabase (Postgres / Auth / Storage / Realtime)。

## セットアップ

1. [supabase.com](https://supabase.com) で新規プロジェクトを作成(Free Plan / Region: Tokyo推奨)
2. `.env.local.example` を `.env.local` にコピーし、Project Settings → API の Project URL / anon key / **service_role key** を設定
   - `SUPABASE_SERVICE_ROLE_KEY` は Seedスクリプトと管理系サーバーコードのみで使用。絶対にクライアントへ露出しないこと
3. Supabase CLIでマイグレーションを適用

   ```bash
   npx supabase login
   npx supabase link --project-ref <あなたのプロジェクトref>
   npx supabase db push
   ```

4. Seed Data投入(本部3名・チーム20組・テスト路線・各駅9ミッション・目的地キュー)

   ```bash
   npm run seed
   ```

5. 開発サーバー起動

   ```bash
   npm run dev
   ```

6. 自動テスト実行(既存のSupabaseプロジェクトに対して直接実行されるため、`npm run seed` 実行後に行うこと)

   ```bash
   npm test
   ```

## ディレクトリ構成

- `supabase/migrations/` — DBスキーマ・RLSポリシー・RPC関数(ゲームロジック本体)
- `scripts/seed.ts` — 開発用Seedデータ投入スクリプト
- `scripts/dev-*.ts` — 手動動作確認用の一時スクリプト(本番では不要)
- `tests/` — Vitestによる自動テスト(経路探索・ミッション・サイコロ・権限)
- `src/lib/supabase/` — Supabaseクライアント(browser / server / admin[service role])
- `src/lib/game/types.ts` — ゲームのステートマシン・enum定義
- `src/lib/game/actor.ts` — ログイン中ユーザーがstaffかteamかを判定するヘルパー
- `src/app/login` — ログイン画面
- `src/app/staff` — 本部ダッシュボード(イベント制御・到着/ミッション承認・チーム個別操作・目的地キュー)
- `src/app/staff/audit` — Audit Logビューア
- `src/app/team` — 参加者画面(サイコロ〜移動〜到着〜ミッション一連のフロー)

## 設計方針(重要)

ゲームの正しい状態は常にサーバー(Postgres)側を正とする。サイコロ結果・コイン残高・ミッション判定・状態遷移等はクライアント側で確定させず、Phase 2以降で追加する `SECURITY DEFINER` のPostgres RPC関数(排他ロック・Idempotency Key付き)経由でのみ変更する。RLSにより `authenticated` / `anon` ロールからの直接 INSERT/UPDATE/DELETE は拒否される。

## Phase進行状況

- [x] Phase 1: プロジェクト基盤・DBスキーマ・RLS・Auth・Seed Data
- [x] Phase 2: 到着フロー(移動先確定・TRAVELING・到着報告・写真Upload・本部承認)
- [x] Phase 3: ミッションフロー(3択・Mission Lock・写真提出・本部判定・Coin Ledger)
- [x] Phase 4: サーバーサイドサイコロ・経路探索・移動先選択
- [x] Phase 5: 本部ダッシュボード拡張・手動調整・最終目的地キュー・Audit Log・イベント開始/終了
- [x] Phase 6: 自動テスト(経路探索・ミッション・サイコロ・権限)。20チーム規模の同時実行負荷テストは未実施
