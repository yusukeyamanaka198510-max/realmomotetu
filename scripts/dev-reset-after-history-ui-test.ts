/**
 * u13確認用テストデータのクリーンアップ。
 * 実行: npx tsx scripts/dev-reset-after-history-ui-test.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { data: team1 } = await admin.from("teams").select("id").eq("team_number", 1).single();
  await admin.from("coin_ledger").delete().eq("team_id", team1!.id);
  await admin.from("card_usage_log").delete().or(`team_id.eq.${team1!.id},target_team_id.eq.${team1!.id}`);
  console.log("クリーンアップ完了");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
