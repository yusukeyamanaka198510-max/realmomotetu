# Slideshow Maker

Google Drive 上の写真・動画を読み込み、いくつかの設定を選ぶだけで自然なスライドショー動画（MP4 / H.264 / AAC）を自動生成する Windows 向けデスクトップアプリです。

「Drive フォルダを指定 → 設定を数個選ぶ → 生成ボタン → 自然な MP4 完成」という操作性を最優先しています。

## 技術構成

- フロントエンド: React + TypeScript（Vite）
- デスクトップシェル: Electron（`electron-vite` で main / preload / renderer をビルド）
- 動画・画像処理: FFmpeg（`ffmpeg-static` / `ffprobe-static` で同梱、xfade / zoompan フィルタを使用）
- 顔検出（クロップの位置決めのみ）: Python + OpenCV（任意。未インストールでも中央クロップにフォールバック）
- Google Drive 連携: `googleapis`（OAuth2, ループバックリダイレクト方式）

## ディレクトリ構成

```
slideshow-app/
  src/
    main/            Electron メインプロセス
      google/        OAuth認証・Drive一覧/ダウンロード
      pipeline/       RNG・プリセット・クロップ・KenBurns・xfade結合・BGM合成・ジョブ進行管理
      ipc/            IPCハンドラ（drive / dialog / job）
    preload/         contextBridge で安全にAPIを公開
    renderer/        React UI
    shared/          main / preload / renderer 共通の型・IPC契約
  python/
    face_detect.py   OpenCV Haar Cascade による顔検出（任意）
  tests/             Vitest ユニットテスト・実FFmpegを使ったスモークテスト
```

## 必要要件

- Node.js 20+
- Windows 上でビルド/実行する想定（開発は他OSでも可）
- （任意）Python 3 + `opencv-python-headless`（顔が写真の端で切れないようにするクロップ機能に使用。未導入でも動作し、中央クロップにフォールバックします）

```
pip install -r python/requirements.txt
```

## Google Drive 連携のセットアップ（初回のみ）

1. [Google Cloud Console](https://console.cloud.google.com/) で新規プロジェクトを作成
2. 「APIとサービス」→「ライブラリ」から **Google Drive API** を有効化
3. 「APIとサービス」→「OAuth同意画面」を設定（Internal or External、テストユーザーとして自分のアカウントを追加）
4. 「認証情報」→「認証情報を作成」→「OAuthクライアントID」→ アプリケーションの種類は **デスクトップアプリ** を選択
5. 発行された「クライアントID」「クライアントシークレット」を控える
6. このディレクトリ (`slideshow-app/`) に `.env.example` をコピーして `.env` を作成し、値を設定

```
cp .env.example .env
# .env を編集して GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を入力
```

サインイン時はシステムの既定ブラウザで Google の同意画面が開き、認証完了後は `http://127.0.0.1:<ランダムポート>/oauth2callback` へのループバックリダイレクトでアプリに戻ります（外部サーバーは使用しません）。取得したトークンは `electron-store` で OS のユーザーデータディレクトリに保存されます。

## 開発

```
npm install
npm run dev        # Electronアプリを開発モードで起動（HMR対応）
npm run typecheck  # main/preload/renderer の型チェック
npm test           # Vitest（純粋ロジック + 実FFmpegを使ったパイプラインのスモークテスト）
```

## ビルド（Windows 向け）

```
npm run build:win
```

`electron-builder.yml` の設定で NSIS インストーラーを `release/` に出力します。`python/` ディレクトリは `extraResources` としてパッケージに同梱されます（Python 本体はユーザー環境にインストールされている必要があります）。

## 主な機能と設計判断

- **素材順序とシード**: 素材はランダムな順序で並べますが、`mulberry32` による決定論的な擬似乱数を使用し、同じシード値なら同じ順序・同じ Ken Burns 動作を再現できます（`JobResult.seedUsed` で確認可能）。
- **顔を考慮したクロップ**: `python/face_detect.py`（OpenCV Haar Cascade）で顔を検出し、`cropPlanner.ts` が顔を切らない位置で目的の縦横比にクロップします。Python/OpenCV が無い環境では自動的に中央クロップにフォールバックし、処理は止まりません。
- **Ken Burns**: `kenBurns.ts` がプリセットとZoom速度に応じてズーム量・パン範囲をシードから決定論的にランダム化し、極端な動きにならないよう範囲をクランプしています。
- **正規化してから結合**: すべての素材（写真・動画）を同一解像度・fps・pixel format (`yuv420p`) の無音セグメントmp4に変換してから、`xfade`（`fade`/`dissolve` のみ）で結合します。
- **動画素材**: 設定された最大使用時間（初期値6秒、UIで1〜30秒に変更可）を超える場合は先頭からトリミングします。元の音声は初期状態でOFFですが、`GenerationSettings.videoClip.useOriginalAudio` として構造は用意済みです（現バージョンでは無視され、常に無音セグメントとして扱われます）。
- **BGM**: 動画より長い場合は動画尺でカットし、終了数秒前からフェードアウトします。動画より短い場合は残りを無音でパディングします。BGMなしの場合は音声トラックなしのMP4を出力します。
- **人物登場回数の平均化**: `personBias.ts` に `PersonTagger` インターフェースと `NoOpPersonTagger`（常に「クラスタ情報なし」を返す）を用意し、`reorderByPersonBias` はクラスタ情報が無ければ何もしません。将来、顔embeddingによるクラスタリング（Person A, Person Bのような匿名ID）を実装した `PersonTagger` に差し替えるだけで有効化できる構造です。
- **エラー耐性**: Drive ダウンロード・素材解析・画像/動画変換の各段階で1素材が失敗しても、その素材だけスキップしてログに記録し、処理全体は継続します（`JobResult.skippedItems` / `JobResult.log`）。
- **進捗**: `drive_fetch → analyzing → image_transform → video_transform → concat → bgm → mux → done` の各段階と割合(%)をIPC経由でリアルタイムにUIへ送信します。
- **一時ファイル**: OSのtempディレクトリ配下 `slideshow-maker/<jobId>/` に作成し、正常終了時のみ自動削除します（失敗時は原因調査のため残します）。

## 既知の制限（今後の拡張ポイント）

- 人物クラスタリング（顔embedding）は未実装（インターフェースのみ）。
- 動画素材の「元音声を使用する」設定は構造のみで、実際のミックスは未実装。
- Google Drive のサブフォルダは再帰的に読み込みません（指定フォルダ直下のファイルのみ）。
- 大量の素材（数百点以上）では `xfade` チェーンが単一の ffmpeg プロセスに含まれるため、メモリ・処理時間が増大します。

## テストについて

`tests/pipeline.smoke.test.ts` と `tests/job.test.ts` は、実際にリポジトリへ同梱される FFmpeg バイナリ（`ffmpeg-static`）を使って合成テスト素材から実際に MP4 を生成し、xfade・Ken Burns・BGM合成・エラー時スキップ・進捗イベントの順序までを検証します。`tests/manual/demo.ts`（`npx vite-node --config vitest.config.ts tests/manual/demo.ts`）は目視確認用にサンプル動画を生成するスクリプトです。
