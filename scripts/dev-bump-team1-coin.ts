/**
 * u11の順位変動演出(▲/▼)確認用: team01のコインを増やして順位を上げる。
 * 実行: npx tsx scripts/dev-bump-team1-coin.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { data: t } = await admin.from("teams").select("id").eq("team_number", 1).single();
  await admin.from("team_state").update({ coin_balance_cache: 90_000_000 }).eq("team_id", t!.id);
  console.log("team01を9000万コインにして1位に浮上させました。");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
