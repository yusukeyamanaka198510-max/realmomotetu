import { createClient } from "@/lib/supabase/server";
import type { StaffRole } from "@/lib/game/types";

export type Actor =
  | { kind: "staff"; userId: string; eventId: string; role: StaffRole; displayName: string }
  | { kind: "team"; userId: string; eventId: string; teamId: string; teamName: string; representativeName: string | null }
  | { kind: "anonymous" };

// ログイン中ユーザーがstaffかteamかを判定する。API/Server Actionの入口で必ず呼び、
// リクエストボディのteam_id等を信用せずここで取得したidのみを以後の処理に使うこと。
export async function getActor(): Promise<Actor> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { kind: "anonymous" };

  const { data: staff } = await supabase
    .from("staff_users")
    .select("event_id, role, display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (staff) {
    return {
      kind: "staff",
      userId: user.id,
      eventId: staff.event_id,
      role: staff.role,
      displayName: staff.display_name,
    };
  }

  const { data: team } = await supabase
    .from("teams")
    .select("id, event_id, team_name, representative_name")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (team) {
    return {
      kind: "team",
      userId: user.id,
      eventId: team.event_id,
      teamId: team.id,
      teamName: team.team_name,
      representativeName: team.representative_name,
    };
  }

  return { kind: "anonymous" };
}
