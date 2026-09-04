"use client";

import { useEffect, useState } from "react";
import { formatYen } from "@/lib/game/format";

const DECOY_AMOUNTS = [10000000, 15000000, 20000000, 25000000, 30000000];

export function CoinSlotOverlay({
  amount,
  bonusAmount,
  onDone,
}: {
  amount: number;
  bonusAmount?: number;
  onDone: () => void;
}) {
  const [spinning, setSpinning] = useState(true);
  const [reelAmount, setReelAmount] = useState(DECOY_AMOUNTS[0]);

  useEffect(() => {
    let ticks = 0;
    const spinInterval = setInterval(() => {
      setReelAmount(DECOY_AMOUNTS[Math.floor(Math.random() * DECOY_AMOUNTS.length)]);
      ticks += 1;
      if (ticks > 8) {
        clearInterval(spinInterval);
        setSpinning(false);
      }
    }, 90);
    return () => clearInterval(spinInterval);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="status">
      <div
        className={`relative w-64 overflow-hidden rounded-[var(--game-radius-lg)] border-4 bg-white p-5 text-center shadow-[var(--game-shadow-lg)] dark:bg-zinc-900 ${
          spinning ? "border-zinc-400" : "border-game-gold anim-card-fly-in"
        }`}
      >
        {!spinning && (
          <div
            className="pointer-events-none absolute inset-y-0 left-0 w-1/3 anim-card-shine"
            style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.85), transparent)" }}
            aria-hidden="true"
          />
        )}
        <p className="relative text-xs font-bold uppercase tracking-wide text-game-gold">🪙コイン獲得!</p>
        <div className="relative mt-3 flex h-16 items-center justify-center overflow-hidden rounded-xl bg-zinc-100 px-2 dark:bg-zinc-800">
          <p className={`font-black ${spinning ? "text-zinc-400 blur-[1px]" : "text-2xl text-game-gold"}`}>
            {spinning ? formatYen(reelAmount) : formatYen(amount)}
          </p>
        </div>
        {!spinning && !!bonusAmount && (
          <p className="anim-pop relative mt-2 rounded-full bg-gradient-to-b from-amber-300 to-game-gold px-3 py-1 text-xs font-black text-amber-950">
            💰お金の神様ボーナス +{formatYen(bonusAmount)}!
          </p>
        )}
        {!spinning && (
          <button
            onClick={onDone}
            className="relative mt-3 rounded-full border-b-4 border-amber-700 bg-gradient-to-b from-amber-300 to-game-gold px-4 py-1.5 text-xs font-bold text-amber-950"
          >
            OK
          </button>
        )}
      </div>
    </div>
  );
}
