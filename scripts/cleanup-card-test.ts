import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env.local" });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
async function main() {
  const { data: event } = await admin.from("events").select("id").single();
  const eventId = event!.id as string;
  const { data: teams } = await admin.from("teams").select("id").eq("event_id", eventId);
  const teamIds = (teams ?? []).map((t) => t.id);

  await admin.from("team_cards").delete().in("team_id", teamIds);
  await admin.from("card_active_effects").delete().in("team_id", teamIds);
  await admin.from("card_usage_log").delete().in("team_id", teamIds);
  await admin.from("card_notifications").delete().in("team_id", teamIds);
  await admin.from("team_property_purchases").delete().in("team_id", teamIds);
  await admin.from("turns").delete().in("team_id", teamIds);
  await admin.from("arrival_submissions").delete().in("team_id", teamIds);
  await admin.from("team_mission_attempts").delete().in("team_id", teamIds);
  await admin
    .from("team_state")
    .update({
      state: "WAITING",
      current_station_id: null,
      current_turn_id: null,
      mission_success_count: 0,
      coin_balance_cache: 0,
      is_paused: false,
    })
    .in("team_id", teamIds);
  await admin.from("events").update({ status: "SCHEDULED", active_destination_station_id: null, end_at: null }).eq("id", eventId);
  console.log("クリーンアップ完了");
}
main();
