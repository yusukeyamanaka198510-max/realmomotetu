/**
 * u11(順位ランキング表デザイン)のUI目視確認用セットアップ。
 * 実行: npx tsx scripts/dev-setup-leaderboard-ui-test.ts
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

  const balances = [30_000_000, 80_000_000, 50_000_000, 50_000_000, 10_000_000];
  for (let i = 1; i <= 5; i++) {
    const { data: t } = await admin.from("teams").select("id").eq("team_number", i).single();
    await admin.from("team_state").update({ state: "WAITING", coin_balance_cache: balances[i - 1], is_paused: false }).eq("team_id", t!.id);
  }
  console.log("セットアップ完了: team01(3万)〜team05(1千万)にコイン差を設定。team01は3位相当。");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
