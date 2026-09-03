import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { admin, rpc, loginToken, getTeamByNumber, resetTeamToDiceReady, getStaffToken } from "./setup";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function clientFor(token: string) {
  return createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

describe("権限・不正操作対策", () => {
  it("参加者は他チームのteam_stateを参照できない(RLS)", async () => {
    const teamA = await getTeamByNumber(19);
    const teamB = await getTeamByNumber(20);
    const tokenA = await loginToken("team19@momotetsu.test");
    const client = clientFor(tokenA);

    const { data: ownRow } = await client.from("team_state").select("team_id").eq("team_id", teamA.id).maybeSingle();
    expect(ownRow?.team_id).toBe(teamA.id);

    const { data: otherRow } = await client.from("team_state").select("team_id").eq("team_id", teamB.id).maybeSingle();
    expect(otherRow).toBeNull();
  });

  it("参加者は他チームを操作するRPCを実行できない(自チーム以外のattempt/turnにアクセス不可)", async () => {
    const teamB = await getTeamByNumber(20);
    await resetTeamToDiceReady(teamB.id, teamB.event_id);

    // teamBにダミーのmission attemptを作成
    const { data: turn } = await admin
      .from("turns")
      .insert({ team_id: teamB.id, turn_number: 1, status: "IN_PROGRESS" })
      .select()
      .single();
    const { data: mission } = await admin.from("station_missions").select("id, station_id").limit(1).single();
    const { data: attempt } = await admin
      .from("team_mission_attempts")
      .insert({ team_id: teamB.id, turn_id: turn!.id, station_id: mission!.station_id, offered_mission_ids: [mission!.id], attempt_number: 1, status: "OFFERED" })
      .select()
      .single();

    const tokenA = await loginToken("team19@momotetsu.test");
    const res = await rpc("fn_select_mission", tokenA, { p_attempt_id: attempt!.id, p_selected_mission_id: mission!.id });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("参加者はコインを直接改ざんできない(coin_ledgerへの直接書込は拒否)", async () => {
    const team = await getTeamByNumber(19);
    const token = await loginToken("team19@momotetsu.test");
    const client = clientFor(token);

    const { error } = await client.from("coin_ledger").insert({
      event_id: team.event_id,
      team_id: team.id,
      amount: 999999,
      transaction_type: "ADMIN_ADJUSTMENT",
      idempotency_key: crypto.randomUUID(),
    });
    expect(error).not.toBeNull();
  });

  it("参加者はteam_stateを直接更新できない(コイン残高改ざん不可)", async () => {
    const team = await getTeamByNumber(19);
    const token = await loginToken("team19@momotetsu.test");
    const client = clientFor(token);

    const { error } = await client.from("team_state").update({ coin_balance_cache: 999999 }).eq("team_id", team.id);
    expect(error).not.toBeNull();
  });

  it("参加者は本部専用RPC(到着承認)を実行できない", async () => {
    const token = await loginToken("team19@momotetsu.test");
    const res = await rpc("fn_review_arrival", token, {
      p_arrival_submission_id: "00000000-0000-0000-0000-000000000000",
      p_decision: "APPROVE",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("本部アカウントは参加者専用RPC(サイコロ)を実行できない", async () => {
    const staffToken = await getStaffToken();
    const res = await rpc("fn_roll_dice", staffToken, { p_dice_count: 1 });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("参加者は本部専用のコイン調整RPCを実行できない", async () => {
    const team = await getTeamByNumber(19);
    const token = await loginToken("team19@momotetsu.test");
    const res = await rpc("fn_admin_adjust_coin", token, { p_team_id: team.id, p_amount: 999999, p_reason: "cheat" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
