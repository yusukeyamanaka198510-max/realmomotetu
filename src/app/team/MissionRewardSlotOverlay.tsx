"use client";

import { useEffect, useRef, useState } from "react";
import { CARD_RARITY_LABELS, type CardRarity } from "@/lib/game/types";
import { formatYen } from "@/lib/game/format";

export type SlotReward =
  | { type: "COIN"; amount: number; bonusAmount?: number }
  | { type: "CARD"; cardName: string; cardRarity: CardRarity };

const DECOY_AMOUNTS = [10000000, 15000000, 20000000, 25000000, 30000000];
const DECOY_CARD_NAMES = ["急行カード", "牛歩カード", "宝くじカード", "半額カード", "絶好調カード", "カードバリア"];

const RARITY_RING: Record<CardRarity, string> = {
  NORMAL: "border-zinc-400",
  RARE: "border-blue-500",
  SUPER_RARE: "border-purple-500",
};
const RARITY_BG: Record<CardRarity, string> = {
  NORMAL: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  RARE: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200",
  SUPER_RARE: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-200",
};

// 減速演出用のディレイ配列(だんだん間隔を空けて、最後に本当の結果で止める)
const SETTLE_DELAYS = [90, 120, 160, 220, 300, 420];

export function MissionRewardSlotOverlay({ reward, onDone }: { reward: SlotReward; onDone: () => void }) {
  const [phase, setPhase] = useState<"spinning" | "settling" | "revealed">("spinning");
  const [reelValue, setReelValue] = useState<string>(reward.type === "COIN" ? formatYen(DECOY_AMOUNTS[0]) : DECOY_CARD_NAMES[0]);
  const spinIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasStoppedRef = useRef(false);

  function pickDecoy() {
    return reward.type === "COIN"
      ? formatYen(DECOY_AMOUNTS[Math.floor(Math.random() * DECOY_AMOUNTS.length)])
      : DECOY_CARD_NAMES[Math.floor(Math.random() * DECOY_CARD_NAMES.length)];
  }

  useEffect(() => {
    spinIntervalRef.current = setInterval(() => setReelValue(pickDecoy()), 90);
    return () => {
      if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- マウント時に一度だけ回転を開始すればよい
  }, []);

  function handleStop() {
    if (hasStoppedRef.current) return;
    hasStoppedRef.current = true;
    if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
    setPhase("settling");

    let i = 0;
    const tick = () => {
      if (i < SETTLE_DELAYS.length) {
        setReelValue(pickDecoy());
        i++;
        setTimeout(tick, SETTLE_DELAYS[i - 1]);
      } else {
        setReelValue(reward.type === "COIN" ? formatYen(reward.amount) : reward.cardName);
        setTimeout(() => setPhase("revealed"), 350);
      }
    };
    tick();
  }

  const spinning = phase === "spinning" || phase === "settling";
  const isCoin = reward.type === "COIN";
  const ringClass = !spinning && !isCoin ? RARITY_RING[reward.cardRarity] : "border-zinc-400";

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/60" role="status">
      <div
        className={`relative w-64 overflow-hidden rounded-[var(--game-radius-lg)] border-4 bg-white p-5 text-center shadow-[var(--game-shadow-lg)] dark:bg-zinc-900 ${
          spinning ? "border-zinc-400" : isCoin ? "border-game-gold anim-card-fly-in" : `${ringClass} anim-card-fly-in`
        }`}
      >
        {!spinning && (
          <div
            className="pointer-events-none absolute inset-y-0 left-0 w-1/3 anim-card-shine"
            style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.85), transparent)" }}
            aria-hidden="true"
          />
        )}
        <p className={`relative text-xs font-bold uppercase tracking-wide ${isCoin ? "text-game-gold" : "text-game-purple"}`}>
          {isCoin ? "🪙コイン獲得!" : "🎴カード獲得!"}
        </p>
        <div className="relative mt-3 flex h-16 items-center justify-center overflow-hidden rounded-xl bg-zinc-100 px-2 dark:bg-zinc-800">
          <p className={`font-bold ${spinning ? "text-zinc-400 blur-[1px]" : isCoin ? "text-2xl text-game-gold" : "text-lg text-zinc-900 dark:text-zinc-50"}`}>
            {reelValue}
          </p>
        </div>
        {!spinning && !isCoin && (
          <span className={`relative mt-3 inline-block rounded-full px-3 py-1 text-xs font-bold ${RARITY_BG[reward.cardRarity]}`}>
            {CARD_RARITY_LABELS[reward.cardRarity]}
          </span>
        )}
        {!spinning && isCoin && reward.bonusAmount && (
          <p className="anim-pop relative mt-2 rounded-full bg-gradient-to-b from-amber-300 to-game-gold px-3 py-1 text-xs font-black text-amber-950">
            💰お金の神様ボーナス +{formatYen(reward.bonusAmount)}!
          </p>
        )}
      </div>

      {phase === "spinning" && (
        <button
          onClick={handleStop}
          className="anim-press rounded-full border-b-4 border-fuchsia-900 bg-gradient-to-b from-game-pink to-fuchsia-600 px-6 py-2.5 text-sm font-bold text-white shadow-[var(--game-shadow-sm)]"
        >
          ⏹ 止める
        </button>
      )}
      {phase === "revealed" && (
        <button
          onClick={onDone}
          className="rounded-full border-b-4 border-amber-700 bg-gradient-to-b from-amber-300 to-game-gold px-6 py-2.5 text-sm font-bold text-amber-950"
        >
          OK
        </button>
      )}
    </div>
  );
}
