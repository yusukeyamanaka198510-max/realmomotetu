import { describe, it, expect } from "vitest";
import { admin, rpc, loginToken, getTeamByNumber, resetTeamToDiceReady } from "./setup";

describe("サイコロ・移動", () => {
  it("出目は1〜6の範囲で、合計は個々の目の合計と一致する", async () => {
    const team = await getTeamByNumber(14);
    await resetTeamToDiceReady(team.id, team.event_id);
    const token = await loginToken("team14@momotetsu.test");

    const res = await rpc("fn_roll_dice", token, { p_dice_count: 1 });
    expect(res.status).toBe(200);
    const diceRollId = res.body as string;

    const { data: roll } = await admin.from("dice_rolls").select("*").eq("id", diceRollId).single();
    expect(roll!.total).toBeGreaterThanOrEqual(1);
    expect(roll!.total).toBeLessThanOrEqual(6);
    expect((roll!.individual_results as number[]).reduce((a, b) => a + b, 0)).toBe(roll!.total);

    const { data: state } = await admin.from("team_state").select("state").eq("team_id", team.id).single();
    expect(state!.state).toBe("DESTINATION_SELECTION");
  });

  it("複数サイコロの合計を正しく計算する(将来のカード拡張用)", async () => {
    const team = await getTeamByNumber(15);
    await resetTeamToDiceReady(team.id, team.event_id);
    const token = await loginToken("team15@momotetsu.test");

    const res = await rpc("fn_roll_dice", token, { p_dice_count: 3 });
    expect(res.status).toBe(200);
    const { data: roll } = await admin.from("dice_rolls").select("*").eq("id", res.body as string).single();
    expect(roll!.individual_results).toHaveLength(3);
    expect(roll!.total).toBeGreaterThanOrEqual(3);
    expect(roll!.total).toBeLessThanOrEqual(18);
  });

  it("DICE_READY以外の状態でのサイコロ実行は拒否される(二重実行防止)", async () => {
    const team = await getTeamByNumber(16);
    await resetTeamToDiceReady(team.id, team.event_id);
    const token = await loginToken("team16@momotetsu.test");

    const first = await rpc("fn_roll_dice", token, { p_dice_count: 1 });
    expect(first.status).toBe(200);

    const second = await rpc("fn_roll_dice", token, { p_dice_count: 1 });
    expect(second.status).toBeGreaterThanOrEqual(400);
  });

  it("到達不可能な駅への移動先確定は拒否される", async () => {
    const team = await getTeamByNumber(17);
    await resetTeamToDiceReady(team.id, team.event_id);
    const token = await loginToken("team17@momotetsu.test");
    const rollRes = await rpc("fn_roll_dice", token, { p_dice_count: 1 });

    const { data: reachable } = await admin
      .from("reachable_stations_snapshot")
      .select("station_id")
      .eq("dice_roll_id", rollRes.body as string);
    const reachableIds = new Set((reachable ?? []).map((r) => r.station_id));

    const { data: allStations } = await admin.from("stations").select("id").eq("event_id", team.event_id);
    const unreachable = allStations!.find((s) => !reachableIds.has(s.id));
    expect(unreachable).toBeDefined();

    const res = await rpc("fn_select_destination", token, { p_station_id: unreachable!.id });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("移動先確定は二重実行しても無害化される", async () => {
    const team = await getTeamByNumber(18);
    await resetTeamToDiceReady(team.id, team.event_id);
    const token = await loginToken("team18@momotetsu.test");
    const rollRes = await rpc("fn_roll_dice", token, { p_dice_count: 1 });
    const { data: snapshot } = await admin
      .from("reachable_stations_snapshot")
      .select("station_id")
      .eq("dice_roll_id", rollRes.body as string)
      .limit(1)
      .single();

    const first = await rpc("fn_select_destination", token, { p_station_id: snapshot!.station_id });
    expect(first.status).toBe(204);
    const second = await rpc("fn_select_destination", token, { p_station_id: snapshot!.station_id });
    expect(second.status).toBe(204);

    const { data: selections } = await admin.from("destination_selections").select("id").eq("team_id", team.id);
    expect(selections).toHaveLength(1);

    const { data: state } = await admin.from("team_state").select("state").eq("team_id", team.id).single();
    expect(state!.state).toBe("TRAVELING");
  });
});
