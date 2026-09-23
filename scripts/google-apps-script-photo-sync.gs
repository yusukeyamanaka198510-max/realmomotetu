/**
 * リアル桃鉄: 到着報告・ミッション報告の写真をSupabase StorageからGoogleドライブへ
 * 自動コピーするGoogle Apps Script。
 *
 * ■セットアップ手順
 * 1. https://script.google.com/ で新しいプロジェクトを作成し、このファイルの内容を
 *    まるごと貼り付ける。
 * 2. 下のCONFIGを埋める。
 *    - SUPABASE_URL: SupabaseダッシュボードのProject Settings > API > Project URL
 *    - SERVICE_ROLE_KEY: 同じ画面の「service_role」キー(secret)。
 *      ★このキーは全データへの無制限アクセス権を持つので、このスクリプト以外の
 *        場所には絶対に貼らない・共有しないこと。
 *    - DRIVE_ROOT_FOLDER_ID: 保存先にしたいGoogleドライブのフォルダを開き、
 *      URLの https://drive.google.com/drive/folders/【この部分】 をコピーする。
 * 3. 上部の関数選択で syncPhotosToDrive を選び、一度手動実行する
 *    (Googleアカウントへのアクセス許可を求められるので許可する)。
 * 4. 左メニューの「トリガー」(時計アイコン) > 「トリガーを追加」で、
 *    実行する関数: syncPhotosToDrive / イベントのソース: 時間主導型 /
 *    分ベースのタイマー: 5分おき、などに設定して保存する。
 * 5. 以降、5分おきに新しい写真が自動的にドライブへコピーされる。
 *    (同じ写真を二重保存しないよう、各テーブルごとに「最後に同期したuploaded_at」
 *     をスクリプトのプロパティに記録して差分だけ取得する)
 */

const CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co", // 例: https://abcdefgh.supabase.co
  SERVICE_ROLE_KEY: "ここにservice_roleキーを貼る",
  DRIVE_ROOT_FOLDER_ID: "ここに保存先フォルダのIDを貼る",
  EVIDENCE_BUCKET: "evidence-photos",
  PAGE_SIZE: 200, // 1回の実行で1テーブルあたり取得する最大件数
};

// テーブルごとの設定: どのテーブルの写真を、どのフォルダ名で、どうチーム名まで辿るか
const TARGETS = [
  {
    table: "arrival_photos",
    folderLabel: "到着写真",
    // PostgRESTのネストselectでチーム名まで辿る
    select: "id,storage_path,uploaded_at,arrival_submissions(teams(team_name))",
    teamName: (row) => row.arrival_submissions && row.arrival_submissions.teams ? row.arrival_submissions.teams.team_name : "不明チーム",
  },
  {
    table: "mission_photos",
    folderLabel: "ミッション写真",
    select: "id,storage_path,uploaded_at,team_mission_attempts(teams(team_name))",
    teamName: (row) => row.team_mission_attempts && row.team_mission_attempts.teams ? row.team_mission_attempts.teams.team_name : "不明チーム",
  },
  {
    table: "bonus_mission_photos",
    folderLabel: "ボーナスミッション写真",
    select: "id,storage_path,uploaded_at,team_bonus_mission_attempts(teams(team_name))",
    teamName: (row) => row.team_bonus_mission_attempts && row.team_bonus_mission_attempts.teams ? row.team_bonus_mission_attempts.teams.team_name : "不明チーム",
  },
  {
    table: "start_checkin_photos",
    folderLabel: "スタート時写真",
    select: "id,storage_path,uploaded_at,team_start_checkins(teams(team_name))",
    teamName: (row) => row.team_start_checkins && row.team_start_checkins.teams ? row.team_start_checkins.teams.team_name : "不明チーム",
  },
];

function syncPhotosToDrive() {
  const rootFolder = DriveApp.getFolderById(CONFIG.DRIVE_ROOT_FOLDER_ID);
  const props = PropertiesService.getScriptProperties();

  TARGETS.forEach((target) => {
    try {
      syncOneTable_(target, rootFolder, props);
    } catch (err) {
      Logger.log(`[${target.table}] エラー: ${err}`);
    }
  });
}

function syncOneTable_(target, rootFolder, props) {
  const propKey = `last_synced_${target.table}`;
  const lastSynced = props.getProperty(propKey);

  const rows = fetchNewRows_(target.table, target.select, lastSynced, CONFIG.PAGE_SIZE);
  if (rows.length === 0) return;

  const categoryFolder = getOrCreateFolder_(rootFolder, target.folderLabel);
  let maxUploadedAt = lastSynced;

  rows.forEach((row) => {
    try {
      const teamName = target.teamName(row) || "不明チーム";
      const teamFolder = getOrCreateFolder_(categoryFolder, teamName);
      saveOnePhoto_(row.storage_path, row.uploaded_at, teamFolder);
      if (!maxUploadedAt || row.uploaded_at > maxUploadedAt) {
        maxUploadedAt = row.uploaded_at;
      }
    } catch (err) {
      Logger.log(`[${target.table}] 写真取得失敗 (${row.storage_path}): ${err}`);
    }
  });

  if (maxUploadedAt) {
    props.setProperty(propKey, maxUploadedAt);
  }
}

function fetchNewRows_(table, select, lastSynced, limit) {
  let url = `${CONFIG.SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&order=uploaded_at.asc&limit=${limit}`;
  if (lastSynced) {
    url += `&uploaded_at=gt.${encodeURIComponent(lastSynced)}`;
  }
  const res = UrlFetchApp.fetch(url, {
    headers: {
      apikey: CONFIG.SERVICE_ROLE_KEY,
      Authorization: `Bearer ${CONFIG.SERVICE_ROLE_KEY}`,
    },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) {
    throw new Error(`${table} の取得に失敗: ${res.getResponseCode()} ${res.getContentText()}`);
  }
  return JSON.parse(res.getContentText());
}

function saveOnePhoto_(storagePath, uploadedAt, targetFolder) {
  const fileName = buildFileName_(storagePath, uploadedAt);
  // 同名ファイルが既にあれば二重保存しない(念のための安全策)
  if (targetFolder.getFilesByName(fileName).hasNext()) return;

  const url = `${CONFIG.SUPABASE_URL}/storage/v1/object/${CONFIG.EVIDENCE_BUCKET}/${storagePath}`;
  const res = UrlFetchApp.fetch(url, {
    headers: {
      apikey: CONFIG.SERVICE_ROLE_KEY,
      Authorization: `Bearer ${CONFIG.SERVICE_ROLE_KEY}`,
    },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) {
    throw new Error(`写真ダウンロード失敗: ${res.getResponseCode()}`);
  }
  const blob = res.getBlob().setName(fileName);
  targetFolder.createFile(blob);
}

function buildFileName_(storagePath, uploadedAt) {
  const ts = uploadedAt ? uploadedAt.replace(/[:.]/g, "-") : "unknown-time";
  const original = storagePath.split("/").pop();
  return `${ts}_${original}`;
}

function getOrCreateFolder_(parent, name) {
  const existing = parent.getFoldersByName(name);
  if (existing.hasNext()) return existing.next();
  return parent.createFolder(name);
}
