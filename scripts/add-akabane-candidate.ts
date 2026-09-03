import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env.local" });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
async function main() {
  const { data: event } = await admin.from("events").select("id").single();
  const { data, error } = await admin
    .from("stations")
    .update({ is_destination_candidate: true })
    .eq("event_id", event!.id)
    .eq("name", "赤羽")
    .select();
  console.log("赤羽 update:", data, error);
}
main();
