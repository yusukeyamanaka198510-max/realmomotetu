/**
 * u13(アクションログ履歴)のUI目視確認用セットアップ。
 * 実行: npx tsx scripts/dev-setup-history-ui-test.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { data: event } = await admin.from("events").select("id").single();
  const eventId = event!.id as string;
  const { data: team1 } = await admin.from("teams").select("id").eq("team_number", 1).single();
  const { data: team2 } = await admin.from("teams").select("id").eq("team_number", 2).single();
  const teamId = team1!.id as string;

  await admin.from("coin_ledger").delete().eq("team_id", teamId);
  await admin.from("coin_ledger").insert([
    { event_id: eventId, team_id: teamId, amount: 20_000_000, transaction_type: "MISSION_SUCCESS", reason: "渋谷ハチ公前チャレンジ", idempotency_key: crypto.randomUUID() },
    { event_id: eventId, team_id: teamId, amount: -10_000_000, transaction_type: "MISSION_FAILURE", reason: "新宿駅前チャレンジ", idempotency_key: crypto.randomUUID() },
    { event_id: eventId, team_id: teamId, amount: 5_000_000, transaction_type: "PROPERTY_PAYOUT", reason: "東京ラーメン店", idempotency_key: crypto.randomUUID() },
    { event_id: eventId, team_id: teamId, amount: 50_000_000, transaction_type: "DESTINATION_BONUS", reason: "秋葉原", idempotency_key: crypto.randomUUID() },
  ]);

  const { data: card } = await admin.from("cards").select("id").eq("card_code", "ADVANCE_1").single();
  await admin.from("card_usage_log").delete().eq("team_id", teamId);
  await admin.from("card_usage_log").insert([
    { event_id: eventId, team_id: teamId, card_id: card!.id, result: "SUCCESS", idempotency_key: crypto.randomUUID() },
    { event_id: eventId, team_id: team2!.id, target_team_id: teamId, card_id: card!.id, result: "BLOCKED", idempotency_key: crypto.randomUUID() },
  ]);

  console.log("セットアップ完了: team01にコイン台帳4件・カード使用ログ2件を投入しました。");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
