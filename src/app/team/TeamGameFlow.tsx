"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { EVIDENCE_BUCKET, arrivalPhotoPath, missionPhotoPath } from "@/lib/game/storage";
import type { TeamGameState } from "@/lib/game/types";
import { formatYen } from "@/lib/game/format";
import { DiceAnimation, type DicePhase } from "./DiceAnimation";
import { GameBadge, GameButton } from "@/components/game-ui";

type MissionAttempt = {
  id: string;
  offered_mission_ids: string[];
  selected_mission_id: string | null;
  status: string;
};
type MissionDifficulty = "EASY" | "NORMAL" | "HARD";
type OfferedMission = { id: string; title: string; description: string; difficulty: MissionDifficulty; reward: number };

const DIFFICULTY_STYLE: Record<MissionDifficulty, { label: string; tone: "green" | "blue" | "red" }> = {
  EASY: { label: "易", tone: "green" },
  NORMAL: { label: "中", tone: "blue" },
  HARD: { label: "難", tone: "red" },
};

function DifficultyBadge({ difficulty }: { difficulty: MissionDifficulty }) {
  const d = DIFFICULTY_STYLE[difficulty];
  return <GameBadge tone={d.tone}>{d.label}</GameBadge>;
}
type DiceResult = { total: number; individual_results: number[] };
type ReachableStation = { id: string; name: string };
type Property = { id: string; name: string; price: number; yield_amount: number; description: string };

export function TeamGameFlow({
  teamId,
  eventId,
  initialState,
  nextStationName,
  missionAttempt,
  offeredMissions,
  diceResult,
  reachableStations,
  properties,
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
  const [dicePhase, setDicePhase] = useState<DicePhase | "done" | null>(null);
  const [missionCelebration, setMissionCelebration] = useState<{ title: string; reward: number } | null>(null);
  const [missionFailureToast, setMissionFailureToast] = useState(false);
  const selectedMission = offeredMissions.find((m) => m.id === missionAttempt?.selected_mission_id) ?? null;

  // ミッション成功の瞬間を検知するため、直前のstateと選択中ミッション情報を覚えておく。
  // MISSION_REVIEW → DICE_READY/PROPERTY_PURCHASE への遷移だけが「成功」を意味する
  // (失敗の場合はMISSION_ACTIVEへ戻るため、この遷移では発火しない)。
  const prevStateRef = useRef<TeamGameState | null>(null);
  const lastMissionRef = useRef<{ title: string; reward: number } | null>(null);
  useEffect(() => {
    if (selectedMission) {
      lastMissionRef.current = { title: selectedMission.title, reward: selectedMission.reward };
    }
  }, [selectedMission]);
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = initialState;
    if (prev === "MISSION_REVIEW" && (initialState === "DICE_READY" || initialState === "PROPERTY_PURCHASE") && lastMissionRef.current) {
      setMissionCelebration(lastMissionRef.current);
      const timer = setTimeout(() => setMissionCelebration(null), 2600);
      return () => clearTimeout(timer);
    }
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
    return () => {
      supabase.removeChannel(channel);
    };
  }, [teamId, router]);

  // ページ再読み込み等でDESTINATION_SELECTION状態のままマウントされた場合も、
  // 演出をスキップせず「確定タップ待ち」から再開する。移動先確定後(state変化)はリセットする。
  useEffect(() => {
    if (initialState === "DESTINATION_SELECTION") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- サーバー状態(initialState)への同期が目的の意図的な同期
      setDicePhase((p) => p ?? "settled");
    } else {
      setDicePhase(null);
    }
  }, [initialState]);

  async function handleRollDice() {
    setError(null);
    setDicePhase("rolling");
    const supabase = createClient();
    const [{ error }] = await Promise.all([
      supabase.rpc("fn_roll_dice", { p_dice_count: 1 }),
      new Promise((resolve) => setTimeout(resolve, 900)),
    ]);
    if (error) {
      setError(error.message);
      setDicePhase(null);
      return;
    }
    await router.refresh();
    setDicePhase("settled");
  }

  function handleConfirmDice() {
    setDicePhase("flying");
    setTimeout(() => setDicePhase("done"), 700);
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
    if (files.length < 1 || files.length > 3) {
      setError("写真は1〜3枚アップロードしてください");
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
    if (missionFiles.length < 1 || missionFiles.length > 3) {
      setError("写真は1〜3枚アップロードしてください");
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
    <div className="mt-6 rounded border border-zinc-200 p-4 dark:border-zinc-800">
      {missionCelebration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="status">
          <div className="anim-slam w-64 rounded-[var(--game-radius-lg)] border-4 border-game-green bg-white p-6 text-center shadow-[var(--game-shadow-lg)] dark:bg-zinc-900">
            <p className="text-4xl">🎉</p>
            <p className="game-text-event mt-1 text-2xl">ミッション達成!</p>
            <p className="mt-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">{missionCelebration.title}</p>
            <p className="mt-2 text-2xl font-black text-game-gold [text-shadow:0_1px_0_rgba(0,0,0,0.15)]">
              +{formatYen(missionCelebration.reward)}
            </p>
          </div>
        </div>
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
          <GameButton onClick={handleStartArrival} disabled={busy} variant="destination" className="w-full">
            🏁 {nextStationName ?? "この駅"}に到着しました
          </GameButton>
        </div>
      )}

      {initialState === "ARRIVAL_SUBMISSION" && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            到着証拠写真を1〜3枚アップロードしてください
          </p>
          <label className="block w-full cursor-pointer rounded border border-dashed border-zinc-400 p-4 text-center text-sm hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-900">
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))}
              className="hidden"
            />
            {files.length > 0 ? `${files.length}枚選択済み(タップして変更)` : "タップして写真を選択"}
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
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{m.title}</p>
                <div className="flex flex-none items-center gap-1.5">
                  <DifficultyBadge difficulty={m.difficulty} />
                  <span className="text-xs font-bold text-amber-700 dark:text-amber-400">+{formatYen(m.reward)}</span>
                </div>
              </div>
              <p className="mt-1.5 text-zinc-600 dark:text-zinc-400">{m.description}</p>
            </button>
          ))}
        </div>
      )}

      {initialState === "MISSION_ACTIVE" && (
        <div className="space-y-3">
          {selectedMission && (
            <div className="rounded-lg border border-zinc-300 bg-zinc-50 p-3.5 dark:border-zinc-700 dark:bg-zinc-900">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-zinc-500">挑戦中のミッション</p>
                <div className="flex flex-none items-center gap-1.5">
                  <DifficultyBadge difficulty={selectedMission.difficulty} />
                  <span className="text-xs font-bold text-amber-700 dark:text-amber-400">+{formatYen(selectedMission.reward)}</span>
                </div>
              </div>
              <p className="mt-1 font-semibold">{selectedMission.title}</p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{selectedMission.description}</p>
            </div>
          )}
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            ミッションを実行し、証拠写真を1〜3枚アップロードしてください
          </p>
          <label className="block w-full cursor-pointer rounded border border-dashed border-zinc-400 p-4 text-center text-sm hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-900">
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setMissionFiles(Array.from(e.target.files ?? []).slice(0, 3))}
              className="hidden"
            />
            {missionFiles.length > 0 ? `${missionFiles.length}枚選択済み(タップして変更)` : "タップして写真を選択"}
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
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-zinc-500">提出したミッション</p>
                <div className="flex flex-none items-center gap-1.5">
                  <DifficultyBadge difficulty={selectedMission.difficulty} />
                  <span className="text-xs font-bold text-amber-700 dark:text-amber-400">+{formatYen(selectedMission.reward)}</span>
                </div>
              </div>
              <p className="mt-1 font-semibold">{selectedMission.title}</p>
            </div>
          )}
          <p className="text-sm text-zinc-600 dark:text-zinc-400">本部の判定をお待ちください...</p>
        </div>
      )}

      {initialState === "PROPERTY_PURCHASE" && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            この駅の物件です。購入すると代金が引かれ、ゲーム終了時に代金+利回りが資産に戻ります。
          </p>
          {properties.map((p) => (
            <div key={p.id} className="rounded border border-zinc-300 p-3 text-sm dark:border-zinc-700">
              <p className="font-medium">{p.name}</p>
              <p className="mt-1 text-zinc-600 dark:text-zinc-400">{p.description}</p>
              <p className="mt-1">
                価格: {formatYen(p.price)} / 利回り: +{formatYen(p.yield_amount)}
              </p>
              <GameButton onClick={() => handlePurchaseProperty(p.id, p.name)} disabled={busy} variant="card" className="mt-2 w-full">
                🏠 購入する
              </GameButton>
            </div>
          ))}
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

      {initialState === "DICE_READY" && (
        <div className="space-y-3">
          {dicePhase === "rolling" ? (
            <DiceAnimation phase="rolling" values={null} onConfirm={() => {}} />
          ) : (
            <GameButton onClick={handleRollDice} variant="dice" size="lg" className="w-full">
              🎲 サイコロを振る
            </GameButton>
          )}
        </div>
      )}

      {initialState === "DESTINATION_SELECTION" && (dicePhase === "settled" || dicePhase === "flying") && (
        <DiceAnimation
          phase={dicePhase}
          values={dicePhase === "flying" ? (diceResult?.individual_results ?? null) : null}
          onConfirm={diceResult ? handleConfirmDice : () => {}}
        />
      )}

      {initialState === "DESTINATION_SELECTION" && dicePhase === "done" && (
        <div className="space-y-3">
          {diceResult && (
            <p className="text-sm">
              サイコロの結果:{" "}
              <span className="text-lg font-bold">{diceResult.total}</span>
              {diceResult.individual_results.length > 1 && (
                <span className="text-zinc-500"> ({diceResult.individual_results.join(" + ")})</span>
              )}
            </p>
          )}
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
            {filteredStations.map((s) => (
              <button
                key={s.id}
                onClick={() => handleSelectDestination(s.id, s.name)}
                disabled={busy}
                className="anim-press rounded-xl border-2 border-sky-300 bg-sky-50 p-3 text-sm font-bold text-sky-900 transition-transform hover:-translate-y-0.5 hover:border-game-skyblue disabled:opacity-50 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100"
              >
                {s.name}
              </button>
            ))}
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
