import { describe, it, expect, beforeAll } from "vitest";
import { admin, rpc, advanceToMissionSelection, getStaffToken } from "./setup";

describe("ミッションフロー", () => {
  beforeAll(async () => {
    await getStaffToken();
  });

  it("3択が提示され、難易度がタイトル・説明文に含まれない", async () => {
    const { attempt } = await advanceToMissionSelection(10, "B駅");
    expect(attempt.offered_mission_ids).toHaveLength(3);
    expect(new Set(attempt.offered_mission_ids).size).toBe(3);

    const { data: missions } = await admin
      .from("station_missions")
      .select("id, title, description, difficulty")
      .in("id", attempt.offered_mission_ids);
    expect(missions).toHaveLength(3);
    const difficulties = new Set(missions!.map((m) => m.difficulty));
    expect(difficulties).toEqual(new Set(["EASY", "NORMAL", "HARD"]));
    for (const m of missions!) {
      expect(m.title).not.toMatch(/EASY|NORMAL|HARD/i);
      expect(m.description).not.toMatch(/EASY|NORMAL|HARD/i);
    }
  });

  it("選択後は変更できない(二重選択は無害化される)", async () => {
    const { teamToken, attempt } = await advanceToMissionSelection(10, "B駅");
    const [first, second] = attempt.offered_mission_ids as string[];

    const select1 = await rpc("fn_select_mission", teamToken, { p_attempt_id: attempt.id, p_selected_mission_id: first });
    expect(select1.status).toBe(204);

    // 別のミッションに変更しようとしても無視され、最初の選択が維持される
    const select2 = await rpc("fn_select_mission", teamToken, { p_attempt_id: attempt.id, p_selected_mission_id: second });
    expect(select2.status).toBe(204);

    const { data: after } = await admin.from("team_mission_attempts").select("selected_mission_id").eq("id", attempt.id).single();
    expect(after!.selected_mission_id).toBe(first);
  });

  it("提示されていないミッションは選択できない", async () => {
    const { teamToken, attempt } = await advanceToMissionSelection(10, "B駅");
    const { data: otherMission } = await admin
      .from("station_missions")
      .select("id")
      .not("id", "in", `(${attempt.offered_mission_ids.join(",")})`)
      .limit(1)
      .single();

    const res = await rpc("fn_select_mission", teamToken, { p_attempt_id: attempt.id, p_selected_mission_id: otherMission!.id });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("失敗するたびに毎回減算され、同じミッションで再挑戦になる", async () => {
    const { teamToken, staffToken, attempt } = await advanceToMissionSelection(11, "B駅");
    const missionId = attempt.offered_mission_ids[0] as string;
    const { data: mission } = await admin.from("station_missions").select("difficulty").eq("id", missionId).single();
    const penalty = { EASY: 250, NORMAL: 500, HARD: 1000 }[mission!.difficulty as "EASY" | "NORMAL" | "HARD"];

    await rpc("fn_select_mission", teamToken, { p_attempt_id: attempt.id, p_selected_mission_id: missionId });
    const { data: t } = await admin.from("teams").select("event_id").eq("id", attempt.team_id).single();
    await rpc("fn_submit_mission_photos", teamToken, {
      p_attempt_id: attempt.id,
      p_photo_paths: [`${t!.event_id}/${attempt.team_id}/mission/${attempt.id}/0.png`],
    });

    const { data: before } = await admin.from("team_state").select("coin_balance_cache").eq("team_id", attempt.team_id).single();
    const review = await rpc("fn_review_mission", staffToken, { p_attempt_id: attempt.id, p_decision: "FAILURE", p_reason: "test" });
    expect(review.status).toBe(204);
    const { data: after } = await admin.from("team_state").select("*").eq("team_id", attempt.team_id).single();
    expect(after!.coin_balance_cache).toBe(before!.coin_balance_cache - penalty);
    expect(after!.state).toBe("MISSION_ACTIVE");

    const { data: retryAttempt } = await admin
      .from("team_mission_attempts")
      .select("*")
      .eq("team_id", attempt.team_id)
      .order("attempt_number", { ascending: false })
      .limit(1)
      .single();
    expect(retryAttempt!.attempt_number).toBe(attempt.attempt_number + 1);
    expect(retryAttempt!.selected_mission_id).toBe(missionId);
  });

  it("成功時はコイン付与されDICE_READYへ戻る", async () => {
    const { teamToken, staffToken, attempt } = await advanceToMissionSelection(12, "B駅");
    const missionId = attempt.offered_mission_ids[0] as string;
    const { data: mission } = await admin.from("station_missions").select("difficulty, success_reward").eq("id", missionId).single();
    const reward = mission!.success_reward ?? { EASY: 500, NORMAL: 1000, HARD: 2000 }[mission!.difficulty as "EASY" | "NORMAL" | "HARD"];

    await rpc("fn_select_mission", teamToken, { p_attempt_id: attempt.id, p_selected_mission_id: missionId });
    const { data: t } = await admin.from("teams").select("event_id").eq("id", attempt.team_id).single();
    await rpc("fn_submit_mission_photos", teamToken, {
      p_attempt_id: attempt.id,
      p_photo_paths: [`${t!.event_id}/${attempt.team_id}/mission/${attempt.id}/0.png`],
    });

    const review = await rpc("fn_review_mission", staffToken, { p_attempt_id: attempt.id, p_decision: "SUCCESS" });
    expect(review.status).toBe(204);

    const { data: after } = await admin.from("team_state").select("*").eq("team_id", attempt.team_id).single();
    expect(after!.coin_balance_cache).toBe(reward);
    expect(after!.state).toBe("DICE_READY");
    expect(after!.mission_success_count).toBe(1);
  });

  it("5回ごとの成功で報酬が2倍になる", async () => {
    const { team, teamToken, staffToken, attempt } = await advanceToMissionSelection(13, "B駅");
    await admin.from("team_state").update({ mission_success_count: 4 }).eq("team_id", team.id);

    const missionId = attempt.offered_mission_ids[0] as string;
    const { data: mission } = await admin.from("station_missions").select("difficulty, success_reward").eq("id", missionId).single();
    const baseReward = mission!.success_reward ?? { EASY: 500, NORMAL: 1000, HARD: 2000 }[mission!.difficulty as "EASY" | "NORMAL" | "HARD"];

    await rpc("fn_select_mission", teamToken, { p_attempt_id: attempt.id, p_selected_mission_id: missionId });
    const { data: t } = await admin.from("teams").select("event_id").eq("id", team.id).single();
    await rpc("fn_submit_mission_photos", teamToken, {
      p_attempt_id: attempt.id,
      p_photo_paths: [`${t!.event_id}/${team.id}/mission/${attempt.id}/0.png`],
    });
    await rpc("fn_review_mission", staffToken, { p_attempt_id: attempt.id, p_decision: "SUCCESS" });

    const { data: after } = await admin.from("team_state").select("coin_balance_cache").eq("team_id", team.id).single();
    expect(after!.coin_balance_cache).toBe(baseReward * 2);

    const { data: ledger } = await admin
      .from("coin_ledger")
      .select("transaction_type, amount")
      .eq("related_mission_attempt_id", attempt.id)
      .single();
    expect(ledger!.transaction_type).toBe("MISSION_5X_BONUS");
    expect(ledger!.amount).toBe(baseReward * 2);
  });
});
