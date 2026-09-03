/**
 * u10(カード使用アニメーション)のUI目視確認用セットアップ。
 * 実行: npx tsx scripts/dev-setup-card-ui-test.ts
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
  const { data: team1 } = await admin.from("teams").select("id").eq("team_number", 1).single();
  const { data: tokyo } = await admin.from("stations").select("id").eq("event_id", eventId).eq("name", "東京").single();

  await admin.from("team_state").update({
    state: "DICE_READY", current_station_id: tokyo!.id, current_turn_id: null,
    coin_balance_cache: 100_000_000, is_paused: false,
  }).eq("team_id", team1!.id);
  await admin.from("team_cards").delete().eq("team_id", team1!.id);
  await admin.from("card_active_effects").delete().eq("team_id", team1!.id);
  await admin.from("turns").delete().eq("team_id", team1!.id);

  const { data: card } = await admin.from("cards").select("id").eq("card_code", "ADVANCE_1").single();
  await admin.from("team_cards").upsert({ team_id: team1!.id, card_id: card!.id, quantity: 1 }, { onConflict: "team_id,card_id" });

  console.log("セットアップ完了: team01をDICE_READY状態にし、ADVANCE_1カードを1枚付与しました。");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
