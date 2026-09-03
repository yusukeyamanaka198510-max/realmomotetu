/**
 * u12確認用テストデータのクリーンアップ。
 * 実行: npx tsx scripts/dev-reset-after-position-map-ui-test.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { data: event } = await admin.from("events").select("id").single();
  const eventId = event!.id as string;
  for (const num of [1, 2, 3]) {
    const { data: t } = await admin.from("teams").select("id").eq("team_number", num).single();
    await admin.from("team_state").update({ state: "WAITING", current_station_id: null, current_turn_id: null }).eq("team_id", t!.id);
    await admin.from("turns").delete().eq("team_id", t!.id);
  }
  await admin.from("events").update({ status: "SCHEDULED" }).eq("id", eventId);
  console.log("クリーンアップ完了");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
