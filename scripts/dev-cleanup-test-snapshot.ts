/**
 * u14確認用に作成したテストスナップショットの削除。
 * 実行: npx tsx scripts/dev-cleanup-test-snapshot.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { error, count } = await admin.from("leaderboard_snapshots").delete({ count: "exact" }).eq("label", "テスト記録");
  console.log("削除件数:", count, error?.message ?? "");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
