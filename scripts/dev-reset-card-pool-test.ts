/**
 * カード出現プールUIテストで作成したデータのクリーンアップ。
 * 実行: npx tsx scripts/dev-reset-card-pool-test.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { data: event } = await admin.from("events").select("id").single();
  const eventId = event!.id as string;
  const { data: stations } = await admin.from("stations").select("id").eq("event_id", eventId);
  const stationIds = (stations ?? []).map((s) => s.id);
  const { error, count } = await admin.from("station_card_pool").delete({ count: "exact" }).in("station_id", stationIds);
  console.log("削除件数:", count, error?.message ?? "");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
