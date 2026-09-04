/**
 * ミッション失敗フィードバックのUI目視確認用(最小構成)。
 * 実行: npx tsx scripts/dev-check-mission-failure.ts review  → MISSION_REVIEWにする
 * 実行: npx tsx scripts/dev-check-mission-failure.ts fail    → MISSION_ACTIVEに戻す(失敗をシミュレート)
 * 実行: npx tsx scripts/dev-check-mission-failure.ts reset   → 後片付け
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const mode = process.argv[2];
  const { data: event } = await admin.from("events").select("id").single();
  const eventId = event!.id as string;
  const { data: team1 } = await admin.from("teams").select("id").eq("team_number", 1).single();
  const { data: tokyo } = await admin.from("stations").select("id").eq("event_id", eventId).eq("name", "東京").single();

  if (mode === "review") {
    await admin.from("events").update({ status: "RUNNING", end_at: new Date(Date.now() + 3600_000).toISOString() }).eq("id", eventId);
    await admin.from("team_state").update({
      state: "MISSION_REVIEW", current_station_id: tokyo!.id, coin_balance_cache: 10_000_000, is_paused: false,
    }).eq("team_id", team1!.id);
    console.log("MISSION_REVIEWにしました");
  } else if (mode === "fail") {
    await admin.from("team_state").update({ state: "MISSION_ACTIVE" }).eq("team_id", team1!.id);
    console.log("MISSION_ACTIVEに戻しました(失敗シミュレート)");
  } else if (mode === "reset") {
    await admin.from("team_state").update({ state: "WAITING", coin_balance_cache: 0, current_station_id: null }).eq("team_id", team1!.id);
    await admin.from("events").update({ status: "SCHEDULED" }).eq("id", eventId);
    console.log("クリーンアップ完了");
  } else {
    console.log("引数に review / fail / reset を指定してください");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
