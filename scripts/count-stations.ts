import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env.local" });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
async function main() {
  const { data: event } = await admin.from("events").select("id").single();
  const { count } = await admin.from("stations").select("*", { count: "exact", head: true }).eq("event_id", event!.id);
  console.log("総駅数:", count);
}
main();
