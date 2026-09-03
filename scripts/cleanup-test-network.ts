/**
 * テスト用の駅(A駅〜J駅)・路線(山手線(テスト)等)と、それに紐づく進行中データ(ターン・
 * サイコロ・到着報告・ミッション挑戦・目的地キュー等)を削除し、実データ(東京23区の駅)のみ
 * にする。チームの状態はWAITINGにリセットし、現在駅は東京駅に設定する。
 *
 * 実行: npx tsx scripts/cleanup-test-network.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: event } = await admin.from("events").select("id").single();
  const eventId = event!.id as string;

  const testStationNames = ["A駅", "B駅", "C駅", "D駅", "E駅", "F駅", "G駅", "H駅", "I駅", "J駅"];
  const { data: testStations } = await admin.from("stations").select("id").eq("event_id", eventId).in("name", testStationNames);
  const testStationIds = (testStations ?? []).map((s) => s.id);

  const { data: tokyoStation } = await admin.from("stations").select("id").eq("event_id", eventId).eq("name", "東京").single();
  if (!tokyoStation) throw new Error("東京駅が見つかりません。先に import-real-tokyo-data.ts を実行してください");

  console.log("進行中データを削除中...");
  await admin.from("mission_photos").delete().not("id", "is", null);
  await admin.from("team_mission_attempts").delete().not("id", "is", null);
  await admin.from("arrival_photos").delete().not("id", "is", null);
  await admin.from("arrival_submissions").delete().not("id", "is", null);
  await admin.from("destination_selections").delete().not("id", "is", null);
  await admin.from("reachable_stations_snapshot").delete().not("id", "is", null);
  await admin.from("dice_rolls").delete().not("id", "is", null);
  await admin.from("turns").delete().not("id", "is", null);
  await admin.from("coin_ledger").delete().not("id", "is", null);
  await admin.from("review_queue").delete().not("id", "is", null);
  await admin.from("audit_log").delete().eq("event_id", eventId);
  await admin.from("destination_queue").delete().eq("event_id", eventId);

  console.log("チーム状態をリセット中...");
  await admin
    .from("team_state")
    .update({
      state: "WAITING",
      current_station_id: tokyoStation.id,
      current_turn_id: null,
      mission_success_count: 0,
      coin_balance_cache: 0,
      is_paused: false,
      paused_from_state: null,
    })
    .eq("event_id", eventId);
  await admin.from("events").update({ start_station_id: tokyoStation.id, status: "SCHEDULED" }).eq("id", eventId);

  console.log("テスト用の駅・路線を削除中...");
  if (testStationIds.length) {
    await admin.from("stations").delete().in("id", testStationIds);
  }
  const testLineNames = ["山手線(テスト)", "中央線(テスト)", "支線(テスト)"];
  await admin.from("lines").delete().eq("event_id", eventId).in("name", testLineNames);

  console.log("完了: テストデータを削除し、東京駅を起点駅に設定しました");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
