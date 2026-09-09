"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { EVIDENCE_BUCKET, arrivalPhotoPath, missionPhotoPath } from "@/lib/game/storage";
import type { TeamGameState } from "@/lib/game/types";
import { formatYen } from "@/lib/game/format";
import { DiceAnimation, type DicePhase } from "./DiceAnimation";
import { MissionRewardSlotOverlay, type SlotReward } from "./MissionRewardSlotOverlay";
import { useDiceCard } from "./DiceCardContext";
import { GameButton } from "@/components/game-ui";

type MissionAttempt = {
  id: string;
  offered_mission_ids: string[];
  selected_mission_id: string | null;
  status: string;
};
type MissionDifficulty = "EASY" | "NORMAL" | "HARD";
type OfferedMission = { id: string; title: string; description: string; difficulty: MissionDifficulty; reward: number };

type DiceResult = { total: number; individual_results: number[] };
type ReachableStation = { id: string; name: string };
type Property = { id: string; name: string; price: number; yield_amount: number; description: string };
type ClaimRewardResult = {
  type: "CARD" | "COIN";
  amount?: number;
  card_name?: string;
  card_rarity?: "NORMAL" | "RARE" | "SUPER_RARE";
  money_god_bonus?: number;
  bombii?: { type: string; amount: number; percent?: number };
};

export function TeamGameFlow({
  teamId,
  eventId,
  initialState,
  nextStationName,
  missionAttempt,
  offeredMissions,
  diceResult,
  reachableStations,
  goalDistanceByStationId,
  properties,
  coinBalance,
  isEventOver,
  isEventScheduled,
}: {
  teamId: string;
  eventId: string;
  initialState: TeamGameState;
  nextStationName: string | null;
  missionAttempt: MissionAttempt | null;
  offeredMissions: OfferedMission[];
  diceResult: DiceResult | null;
  reachableStations: ReachableStation[];
  coinBalance: number;
  goalDistanceByStationId: Record<string, number>;
  properties: Property[];
  isEventOver: boolean;
  isEventScheduled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [missionFiles, setMissionFiles] = useState<File[]>([]);
  const [stationQuery, setStationQuery] = useState("");
  const { dicePhase, canStopDice, rollingDiceCount, rollPlainDice, stopDice, diceLanded } = useDiceCard();
  // 振り始めた直後はサーバーの本当の出目(diceResult)がまだ届いていないことがあるため、
  // 個数だけ先に確定させたrollingDiceCount分のダミー配列で個数のズレを防ぐ。
  // 出目そのものは回転中は見えないため、着地(canStopDiceが立つ=diceResultが届いた後)までは
  // 中身が不正確でも問題ない。
  const rollingDiceValues =
    diceResult && diceResult.individual_results.length === rollingDiceCount
      ? diceResult.individual_results
      : Array.from({ length: rollingDiceCount }, () => 1);
  const [missionFailureToast, setMissionFailureToast] = useState(false);
  const [slotReward, setSlotReward] = useState<SlotReward | null>(null);
  // 報酬を通常通り見せた後にボンビーの悪さを発生させるため、悪さの情報は一旦ここに保留しておく。
  const [pendingBombii, setPendingBombii] = useState<{ type: string; amount: number; percent?: number } | null>(null);
  const [bombiiStage, setBombiiStage] = useState<"announce" | "detail" | "escape" | "team_slot" | null>(null);
  const [bombiiInfo, setBombiiInfo] = useState<{ type: string; amount: number; percent?: number } | null>(null);
  const [escapeDicePhase, setEscapeDicePhase] = useState<DicePhase | null>(null);
  const [escapeCanStop, setEscapeCanStop] = useState(false);
  const [escapeRoll, setEscapeRoll] = useState<{ roll: number; escaped: boolean; new_holder_team_name?: string } | null>(null);
  const selectedMission = offeredMissions.find((m) => m.id === missionAttempt?.selected_mission_id) ?? null;
  // 「サイコロを振る」ボタンと回転演出は、周りの白い枠なしで背景イラストの上に直接見せる。
  const hideOuterPanel = initialState === "DICE_READY" || dicePhase === "rolling" || dicePhase === "landing";

  // 失敗トーストを出すため、直前のstateを覚えておく
  // (MISSION_REVIEW → MISSION_ACTIVE への遷移だけが「失敗して再挑戦」を意味する)。
  const prevStateRef = useRef<TeamGameState | null>(null);
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = initialState;
    if (prev === "MISSION_REVIEW" && initialState === "MISSION_ACTIVE") {
      setMissionFailureToast(true);
      const timer = setTimeout(() => setMissionFailureToast(false), 1800);
      return () => clearTimeout(timer);
    }
  }, [initialState]);

  const sortedStations = useMemo(
    () => [...reachableStations].sort((a, b) => a.name.localeCompare(b.name, "ja")),
    [reachableStations]
  );
  const filteredStations = useMemo(
    () => (stationQuery.trim() ? sortedStations.filter((s) => s.name.includes(stationQuery.trim())) : sortedStations),
    [sortedStations, stationQuery]
  );

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`team_state:${teamId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "team_state", filter: `team_id=eq.${teamId}` },
        () => router.refresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "team_mission_attempts", filter: `team_id=eq.${teamId}` },
        () => router.refresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dice_rolls", filter: `team_id=eq.${teamId}` },
        () => router.refresh()
      )
      .subscribe();
    supabase.rpc("fn_maybe_run_dividend_settlement");
    supabase.rpc("fn_maybe_take_leaderboard_snapshot");
    supabase.rpc("fn_maybe_run_lucky_hourly_bonus");
    // Realtimeが本番回線の瞬断等で切れた場合に備え、ポーリングでも状態を追従させる
    // (本部の承認待ち等でRealtimeだけに頼ると、切断中は画面が固まって見えてしまうため)。
    // 同じポーリングに乗せて、定期配当・順位表自動記録・ラッキーチャンスの
    // 「間隔を過ぎていれば実行」判定も軽く叩く。
    const interval = setInterval(() => {
      supabase.rpc("fn_maybe_run_dividend_settlement");
      supabase.rpc("fn_maybe_take_leaderboard_snapshot");
      supabase.rpc("fn_maybe_run_lucky_hourly_bonus");
      router.refresh();
    }, 15000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [teamId, router]);

  async function handleRollDice() {
    setError(null);
    const { error } = await rollPlainDice();
    if (error) setError(error);
  }

  async function handleSelectDestination(stationId: string, stationName: string) {
    if (!window.confirm(`${stationName}に移動します。確定後は変更できません。よろしいですか?`)) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_select_destination", { p_station_id: stationId });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  async function handleStartArrival() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_start_arrival");
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  async function handleSubmitArrival() {
    if (files.length !== 1) {
      setError("写真を1枚アップロードしてください");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const idempotencyKey = crypto.randomUUID();

    try {
      const paths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const path = arrivalPhotoPath(eventId, teamId, idempotencyKey, i, files[i].name);
        const { error: uploadError } = await supabase.storage
          .from(EVIDENCE_BUCKET)
          .upload(path, files[i]);
        if (uploadError) throw uploadError;
        paths.push(path);
      }

      const { error: rpcError } = await supabase.rpc("fn_submit_arrival", {
        p_photo_paths: paths,
        p_idempotency_key: idempotencyKey,
      });
      if (rpcError) throw rpcError;

      setFiles([]);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提出に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  async function handleSelectMission(missionId: string) {
    if (!missionAttempt) return;
    if (!window.confirm("一度選択すると変更できません。このミッションでよろしいですか?")) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_select_mission", {
      p_attempt_id: missionAttempt.id,
      p_selected_mission_id: missionId,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  async function handlePurchaseProperty(propertyId: string, name: string) {
    if (!window.confirm(`「${name}」を購入します。よろしいですか?`)) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_purchase_property", { p_property_id: propertyId });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  async function handleFinishPropertyPurchase() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_finish_property_purchase");
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  async function handleSubmitMissionPhotos() {
    if (!missionAttempt) return;
    if (missionFiles.length !== 1) {
      setError("写真を1枚アップロードしてください");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();

    try {
      const paths: string[] = [];
      for (let i = 0; i < missionFiles.length; i++) {
        const path = missionPhotoPath(eventId, teamId, missionAttempt.id, i, missionFiles[i].name);
        const { error: uploadError } = await supabase.storage
          .from(EVIDENCE_BUCKET)
          .upload(path, missionFiles[i]);
        if (uploadError) throw uploadError;
        paths.push(path);
      }

      const { error: rpcError } = await supabase.rpc("fn_submit_mission_photos", {
        p_attempt_id: missionAttempt.id,
        p_photo_paths: paths,
      });
      if (rpcError) throw rpcError;

      setMissionFiles([]);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提出に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  function revealReward(result: ClaimRewardResult) {
    if (result.type === "COIN") {
      setSlotReward({ type: "COIN", amount: result.amount ?? 0, bonusAmount: result.money_god_bonus });
    } else {
      setSlotReward({ type: "CARD", cardName: result.card_name ?? "", cardRarity: result.card_rarity ?? "NORMAL" });
    }
  }

  async function handleClaimReward(choice: "CARD" | "COIN") {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("fn_claim_mission_reward", { p_choice: choice });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    const result = data as ClaimRewardResult;
    // ボンビーの悪さが発生していても、まずは通常通り報酬を見せる。
    // 悪さの演出は報酬の演出が終わった後(MissionRewardSlotOverlayのonDone)に始める。
    if (result.bombii) {
      setPendingBombii(result.bombii);
    }
    revealReward(result);
  }

  function startBombiiFlow() {
    if (!pendingBombii) {
      router.refresh();
      return;
    }
    setBombiiInfo(pendingBombii);
    setPendingBombii(null);
    setBombiiStage("announce");
  }

  function finishBombiiFlow() {
    setBombiiStage(null);
    setBombiiInfo(null);
    setEscapeDicePhase(null);
    setEscapeCanStop(false);
    setEscapeRoll(null);
    router.refresh();
  }

  async function handleBombiiEscapeRoll() {
    setBusy(true);
    setEscapeDicePhase("rolling");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("fn_bombii_escape_roll");
    setBusy(false);
    if (error) {
      setError(error.message);
      setEscapeDicePhase(null);
      return;
    }
    // このRPCは出目・結果を既に確定させた状態で返す(dice_rolls経由の非同期反映を待つ必要がない)ため、
    // 通常のサイコロと違いrouter.refresh()を待たずそのまま「止める」を有効化してよい。
    setEscapeRoll(data as { roll: number; escaped: boolean; new_holder_team_name?: string });
    setEscapeCanStop(true);
  }

  function handleEscapeDiceLanded() {
    setEscapeDicePhase("revealed");
  }

  function handleEscapeNext() {
    if (escapeRoll?.escaped) {
      setBombiiStage("team_slot");
    } else {
      finishBombiiFlow();
    }
  }

  if (isEventOver) {
    return (
      <div className="anim-pop mt-6 overflow-hidden rounded-[var(--game-radius-lg)] border-4 border-game-gold bg-gradient-to-b from-game-navy to-slate-900 p-8 text-center shadow-[var(--game-shadow-lg)]">
        <p className="text-4xl">🏁</p>
        <p className="game-text-event mt-2 text-3xl">ゲーム終了!</p>
        <p className="mt-3 text-sm font-bold text-white/90">お疲れ様でした!</p>
        <p className="mt-4 rounded-xl bg-white/10 px-4 py-3 text-sm font-bold text-game-gold">
          🏆 優勝チームの発表は二次会で!お楽しみに
        </p>
      </div>
    );
  }

  if (isEventScheduled) {
    return (
      <div className="mt-6 rounded border border-zinc-200 p-6 text-center dark:border-zinc-800">
        <p className="text-base font-semibold">開始をお待ちください</p>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">本部がゲームを開始すると、ここにサイコロを振るボタンが表示されます。</p>
      </div>
    );
  }

  return (
    <div
      className={
        hideOuterPanel
          ? "mt-6"
          : "mt-6 rounded border border-zinc-200 bg-white p-4 shadow-[var(--game-shadow-sm)] dark:border-zinc-800 dark:bg-zinc-900"
      }
    >
      {slotReward && (
        <MissionRewardSlotOverlay
          reward={slotReward}
          onDone={() => {
            setSlotReward(null);
            startBombiiFlow();
          }}
        />
      )}

      {bombiiStage === "announce" && (
        <div role="alertdialog" className="fixed inset-0 z-[65] flex flex-col items-center justify-center bg-black/80 px-6">
          <div className="anim-shake w-full max-w-xs rounded-[var(--game-radius-lg)] border-4 border-purple-500 bg-white p-6 text-center shadow-[var(--game-shadow-lg)] dark:bg-zinc-900">
            <p className="text-4xl">😈</p>
            <p className="game-text-event mt-2 text-xl text-purple-700 dark:text-purple-300">ボンビーの悪さが発生しました!</p>
            <GameButton onClick={() => setBombiiStage("detail")} variant="primary" className="mt-4 w-full">
              確認
            </GameButton>
          </div>
        </div>
      )}

      {bombiiStage === "detail" && bombiiInfo && (
        <div role="alertdialog" className="fixed inset-0 z-[65] flex flex-col items-center justify-center bg-black/80 px-6">
          <div className="w-full max-w-xs rounded-[var(--game-radius-lg)] border-4 border-purple-500 bg-white p-6 text-center shadow-[var(--game-shadow-lg)] dark:bg-zinc-900">
            <p className="text-4xl">😈</p>
            <p className="game-text-event mt-2 text-xl text-purple-700 dark:text-purple-300">ボンビーの悪さ!</p>
            <p className="mt-2 text-sm">
              {bombiiInfo.type === "PROPERTY_SOLD"
                ? `不動産を強制的に安売りさせられました(+${formatYen(bombiiInfo.amount)}だけ手元に)`
                : bombiiInfo.amount > 0
                  ? `現金の${bombiiInfo.percent}%(${formatYen(bombiiInfo.amount)})を奪われました`
                  : "手持ちの現金がなく、被害はありませんでした"}
            </p>
            <GameButton
              onClick={() => {
                setBombiiStage("escape");
                void handleBombiiEscapeRoll();
              }}
              disabled={busy}
              variant="dice"
              className="mt-4 w-full"
            >
              🎲 撃退チャレンジ(サイコロを振る)
            </GameButton>
          </div>
        </div>
      )}

      {bombiiStage === "escape" && (
        <div role="alertdialog" className="fixed inset-0 z-[65] flex flex-col items-center justify-center bg-black/80 px-6">
          <div className="w-full max-w-xs rounded-[var(--game-radius-lg)] border-4 border-purple-500 bg-white p-6 text-center shadow-[var(--game-shadow-lg)] dark:bg-zinc-900">
            <p className="game-text-event text-xl text-purple-700 dark:text-purple-300">撃退チャレンジ</p>
            {(escapeDicePhase === "rolling" || escapeDicePhase === "landing") && (
              <div className="mt-3 space-y-3">
                <DiceAnimation phase={escapeDicePhase} values={[escapeRoll?.roll ?? 1]} onLanded={handleEscapeDiceLanded} />
                <GameButton
                  onClick={() => setEscapeDicePhase("landing")}
                  disabled={!escapeCanStop}
                  variant="dice"
                  size="lg"
                  className="w-full"
                >
                  {escapeCanStop ? "⏹ 止める" : "🎲 振っています…"}
                </GameButton>
              </div>
            )}
            {escapeDicePhase === "revealed" && escapeRoll && (
              <div className="mt-3 space-y-3">
                <DiceAnimation phase="revealed" values={[escapeRoll.roll]} />
                <p className={`text-sm font-bold ${escapeRoll.escaped ? "text-emerald-600" : "text-zinc-500"}`}>
                  {escapeRoll.escaped ? "撃退成功!なすりつけ先を決めます" : "撃退失敗…まだボンビーが憑いています"}
                </p>
                <GameButton onClick={handleEscapeNext} variant="primary" className="w-full">
                  つぎへ
                </GameButton>
              </div>
            )}
          </div>
        </div>
      )}

      {bombiiStage === "team_slot" && escapeRoll?.new_holder_team_name && (
        <MissionRewardSlotOverlay
          reward={{ type: "TEAM", teamName: escapeRoll.new_holder_team_name }}
          onDone={finishBombiiFlow}
        />
      )}

      {missionFailureToast && (
        <div className="anim-shake pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
          <div className="rounded-full border-2 border-zinc-300 bg-white px-4 py-2 text-sm font-bold shadow-[var(--game-shadow-md)] dark:border-zinc-700 dark:bg-zinc-900">
            💦 残念! もう一度チャレンジしよう
          </div>
        </div>
      )}

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {initialState === "TRAVELING" && (
        <div className="space-y-3">
          <p className="text-sm">
            次の目的駅: <span className="font-semibold">{nextStationName ?? "-"}</span>
          </p>
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
            👉 {nextStationName ?? "この駅"}に到着したら、下のボタンをタップしよう！
          </p>
          <GameButton onClick={handleStartArrival} disabled={busy} variant="destination" className="w-full">
            🏁 {nextStationName ?? "この駅"}に到着しました
          </GameButton>
        </div>
      )}

      {initialState === "ARRIVAL_SUBMISSION" && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            到着証拠写真を1枚アップロードしてください
          </p>
          <label className="block w-full cursor-pointer rounded border border-dashed border-zinc-400 p-4 text-center text-sm hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-900">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 1))}
              className="hidden"
            />
            {files.length > 0 ? "1枚選択済み(タップして変更)" : "タップして写真を選択"}
          </label>
          <GameButton onClick={handleSubmitArrival} disabled={busy || files.length === 0} variant="primary" className="w-full">
            {busy ? "提出中..." : "📸 提出する"}
          </GameButton>
        </div>
      )}

      {initialState === "ARRIVAL_REVIEW" && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          本部の確認をお待ちください...
        </p>
      )}

      {initialState === "MISSION_SELECTION" && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            3つのミッションから1つ選んでください(一度選択すると変更できません)
          </p>
          {offeredMissions.map((m) => (
            <button
              key={m.id}
              onClick={() => handleSelectMission(m.id)}
              disabled={busy}
              className="anim-press w-full rounded-xl border-2 border-zinc-300 bg-white p-3.5 text-left text-sm shadow-[var(--game-shadow-sm)] transition-transform hover:-translate-y-0.5 hover:border-game-blue disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <p className="font-semibold">{m.title}</p>
              <p className="mt-1.5 text-zinc-600 dark:text-zinc-400">{m.description}</p>
            </button>
          ))}
        </div>
      )}

      {initialState === "MISSION_ACTIVE" && (
        <div className="space-y-3">
          {selectedMission && (
            <div className="rounded-lg border border-zinc-300 bg-zinc-50 p-3.5 dark:border-zinc-700 dark:bg-zinc-900">
              <p className="text-xs text-zinc-500">挑戦中のミッション</p>
              <p className="mt-1 font-semibold">{selectedMission.title}</p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{selectedMission.description}</p>
            </div>
          )}
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            ミッションを実行し、証拠写真を1枚アップロードしてください
          </p>
          <label className="block w-full cursor-pointer rounded border border-dashed border-zinc-400 p-4 text-center text-sm hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-900">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setMissionFiles(Array.from(e.target.files ?? []).slice(0, 1))}
              className="hidden"
            />
            {missionFiles.length > 0 ? "1枚選択済み(タップして変更)" : "タップして写真を選択"}
          </label>
          <GameButton onClick={handleSubmitMissionPhotos} disabled={busy || missionFiles.length === 0} variant="success" className="w-full">
            {busy ? "提出中..." : "📸 提出する"}
          </GameButton>
        </div>
      )}

      {initialState === "MISSION_REVIEW" && (
        <div className="space-y-3">
          {selectedMission && (
            <div className="rounded-lg border border-zinc-300 bg-zinc-50 p-3.5 dark:border-zinc-700 dark:bg-zinc-900">
              <p className="text-xs text-zinc-500">提出したミッション</p>
              <p className="mt-1 font-semibold">{selectedMission.title}</p>
            </div>
          )}
          <p className="text-sm text-zinc-600 dark:text-zinc-400">本部の判定をお待ちください...</p>
        </div>
      )}

      {initialState === "MISSION_REWARD_CHOICE" && (
        <div className="space-y-3 text-center">
          <p className="anim-pop game-text-event text-2xl">🎉ミッション達成!</p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">報酬を選んでください</p>
          <div className="grid grid-cols-2 gap-3">
            <GameButton onClick={() => handleClaimReward("CARD")} disabled={busy} variant="card" size="lg" className="flex-col !py-4">
              🎴
              <br />
              カード
            </GameButton>
            <GameButton onClick={() => handleClaimReward("COIN")} disabled={busy} variant="destination" size="lg" className="flex-col !py-4">
              🪙
              <br />
              コイン
            </GameButton>
          </div>
        </div>
      )}

      {initialState === "PROPERTY_PURCHASE" && (
        <div className="space-y-3">
          {properties.map((p) => {
            const affordable = coinBalance >= p.price;
            const yieldPercent = p.price > 0 ? Math.round((p.yield_amount / p.price) * 1000) / 10 : 0;
            return (
              <div key={p.id} className="rounded border border-zinc-300 p-3 text-sm dark:border-zinc-700">
                <p className="font-medium">{p.name}</p>
                <p className={`mt-1 ${affordable ? "" : "font-bold text-game-red"}`}>
                  価格: {formatYen(p.price)} / 利回り: {yieldPercent}%
                  {!affordable && " (資産不足)"}
                </p>
                <GameButton onClick={() => handlePurchaseProperty(p.id, p.name)} disabled={busy || !affordable} variant="card" className="mt-2 w-full">
                  🏠 購入する
                </GameButton>
              </div>
            );
          })}
          {properties.length === 0 && <p className="text-sm text-zinc-500">この駅に物件はありません</p>}
          <button
            onClick={handleFinishPropertyPurchase}
            disabled={busy}
            className="w-full rounded border border-zinc-300 py-2 text-sm font-medium disabled:opacity-50 dark:border-zinc-700"
          >
            購入せず次へ進む
          </button>
        </div>
      )}

      {(initialState === "DICE_READY" || initialState === "DESTINATION_SELECTION") && (dicePhase === "rolling" || dicePhase === "landing") && (
        <div className="space-y-3">
          <DiceAnimation phase={dicePhase} values={rollingDiceValues} onLanded={diceLanded} />
          {dicePhase === "rolling" && (
            <GameButton onClick={stopDice} disabled={!canStopDice} variant="dice" size="lg" className="w-full">
              {canStopDice ? "⏹ 止める" : "🎲 振っています…"}
            </GameButton>
          )}
        </div>
      )}

      {initialState === "DICE_READY" && dicePhase === null && (
        <GameButton onClick={handleRollDice} variant="dice" size="lg" className="w-full">
          🎲 サイコロを振る
        </GameButton>
      )}

      {initialState === "DESTINATION_SELECTION" && dicePhase === "revealed" && (
        <div className="space-y-3">
          {diceResult && <DiceAnimation phase="revealed" values={diceResult.individual_results} />}
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            移動先を選んでください({reachableStations.length}駅から選択可能)
          </p>
          {reachableStations.length === 0 && (
            <p className="text-sm text-red-600">到達可能な駅がありません。本部にお問い合わせください。</p>
          )}
          {reachableStations.length > 8 && (
            <input
              type="text"
              value={stationQuery}
              onChange={(e) => setStationQuery(e.target.value)}
              placeholder="駅名で絞り込み"
              className="w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            />
          )}
          {filteredStations.length === 0 && stationQuery && (
            <p className="text-sm text-zinc-500">「{stationQuery}」に一致する駅はありません</p>
          )}
          <div className="grid max-h-[50vh] grid-cols-2 gap-2 overflow-y-auto">
            {filteredStations.map((s) => {
              const dist = goalDistanceByStationId[s.id];
              const isGoal = dist === 0;
              return (
                <button
                  key={s.id}
                  onClick={() => handleSelectDestination(s.id, s.name)}
                  disabled={busy}
                  className={`anim-press rounded-xl border-2 p-3 text-left text-sm font-bold transition-transform hover:-translate-y-0.5 disabled:opacity-50 ${
                    isGoal
                      ? "border-game-gold bg-amber-50 text-amber-900 hover:border-game-gold dark:bg-amber-950 dark:text-amber-100"
                      : "border-sky-300 bg-sky-50 text-sky-900 hover:border-game-skyblue dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100"
                  }`}
                >
                  <span className="block">{s.name}</span>
                  <span className={`mt-0.5 block text-[10px] font-normal ${isGoal ? "text-amber-600" : "text-zinc-500 dark:text-zinc-400"}`}>
                    {dist === undefined ? "" : isGoal ? "🏁 ここがゴール!" : `ゴールまで ${dist}マス`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {initialState === "PAUSED" && (
        <p className="text-sm font-medium text-amber-600">
          本部により一時停止されています。本部の指示があるまでお待ちください。
        </p>
      )}

      {![
        "TRAVELING",
        "ARRIVAL_SUBMISSION",
        "ARRIVAL_REVIEW",
        "MISSION_SELECTION",
        "MISSION_ACTIVE",
        "MISSION_REVIEW",
        "MISSION_REWARD_CHOICE",
        "DICE_READY",
        "DESTINATION_SELECTION",
        "PROPERTY_PURCHASE",
        "PAUSED",
      ].includes(initialState) && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          状態を確認しています…(現在の状態: {initialState})
        </p>
      )}
    </div>
  );
}
