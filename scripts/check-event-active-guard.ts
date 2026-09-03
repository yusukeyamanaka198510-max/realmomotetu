import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env.local" });

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const FUNCS = [
  "fn_roll_dice",
  "fn_select_destination",
  "fn_start_arrival",
  "fn_submit_arrival",
  "fn_select_mission",
  "fn_submit_mission_photos",
  "fn_purchase_property",
  "fn_finish_property_purchase",
  "fn_use_card",
  "fn_review_arrival",
  "fn_review_mission",
];

async function main() {
  for (const fn of FUNCS) {
    const { data, error } = await admin.rpc("fn_debug_get_source", { p_name: fn });
    if (error) {
      console.log(fn, "ERROR", error.message);
      continue;
    }
    const src = data as unknown as string;
    console.log(fn, "-> fn_assert_event_active present:", src?.includes("fn_assert_event_active"));
  }
}
main();
