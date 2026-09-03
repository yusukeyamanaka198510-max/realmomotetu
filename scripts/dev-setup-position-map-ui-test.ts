/**
 * u12(現在地マップ)のUI目視確認用セットアップ。
 * 実行: npx tsx scripts/dev-setup-position-map-ui-test.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { data: event } = await admin.from("events").select("id").single();
  const eventId = event!.id as string;
  await admin.from("events").update({ status: "RUNNING", end_at: new Date(Date.now() + 3600_000).toISOString() }).eq("id", eventId);

  async function stationId(name: string) {
    const { data } = await admin.from("stations").select("id").eq("event_id", eventId).eq("name", name).single();
    return data!.id as string;
  }
  const tokyo = await stationId("東京");
  const shinagawa = await stationId("品川");
  const shinjuku = await stationId("新宿");

  const { data: team1 } = await admin.from("teams").select("id").eq("team_number", 1).single();
  const { data: team2 } = await admin.from("teams").select("id").eq("team_number", 2).single();
  const { data: team3 } = await admin.from("teams").select("id").eq("team_number", 3).single();

  await admin.from("turns").delete().eq("team_id", team1!.id);
  const { data: turn1 } = await admin
    .from("turns")
    .insert({ team_id: team1!.id, turn_number: 1, previous_station_id: tokyo, next_station_id: shinagawa, status: "IN_PROGRESS" })
    .select("id")
    .single();

  await admin.from("team_state").update({ state: "TRAVELING", current_station_id: tokyo, current_turn_id: turn1!.id }).eq("team_id", team1!.id);
  await admin.from("team_state").update({ state: "WAITING", current_station_id: shinjuku, current_turn_id: null }).eq("team_id", team2!.id);
  await admin.from("team_state").update({ state: "WAITING", current_station_id: shinagawa, current_turn_id: null }).eq("team_id", team3!.id);

  console.log("セットアップ完了: team01(東京→品川間 移動中) / team02(新宿) / team03(品川)");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
