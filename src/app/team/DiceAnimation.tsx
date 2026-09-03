"use client";

import { useEffect, useState } from "react";

const PIP_LAYOUTS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [0, 2],
    [2, 0],
    [2, 2],
  ],
  5: [
    [0, 0],
    [0, 2],
    [1, 1],
    [2, 0],
    [2, 2],
  ],
  6: [
    [0, 0],
    [0, 2],
    [1, 0],
    [1, 2],
    [2, 0],
    [2, 2],
  ],
};

function DieFace({ value, spinning, justLanded }: { value: number; spinning: boolean; justLanded: boolean }) {
  return (
    <div
      className={`grid h-16 w-16 grid-cols-3 grid-rows-3 gap-1 rounded-xl border-4 border-game-navy bg-white p-2.5 shadow-[var(--game-shadow-md)] ${
        spinning ? "animate-[spin_0.5s_linear_infinite]" : justLanded ? "anim-slam" : ""
      }`}
    >
      {Array.from({ length: 9 }).map((_, i) => {
        const row = Math.floor(i / 3);
        const col = i % 3;
        const active = PIP_LAYOUTS[value]?.some(([r, c]) => r === row && c === col);
        return <div key={i} className={`rounded-full ${active ? "bg-game-red" : ""}`} />;
      })}
    </div>
  );
}

export type DicePhase = "rolling" | "settled" | "flying";

export function DiceAnimation({
  phase,
  values,
  onConfirm,
}: {
  phase: DicePhase;
  values: number[] | null;
  onConfirm: () => void;
}) {
  const [tumbleValue, setTumbleValue] = useState(1);

  useEffect(() => {
    if (phase !== "rolling") return;
    const interval = setInterval(() => setTumbleValue(1 + Math.floor(Math.random() * 6)), 90);
    return () => clearInterval(interval);
  }, [phase]);

  const showValues = values && values.length > 0 ? values : [tumbleValue];
  const isCentered = phase === "flying";

  return (
    <div className="relative flex h-40 items-end justify-center overflow-hidden">
      {phase === "settled" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-24 w-24 rounded-full bg-game-gold/30 blur-xl" />
        </div>
      )}
      <div
        className={`relative flex gap-2 transition-all motion-reduce:transition-none ${
          isCentered ? "translate-y-[-40px] scale-125 duration-700 ease-out" : "translate-y-0 scale-100 duration-300"
        }`}
      >
        {showValues.map((v, i) => (
          <DieFace key={i} value={v} spinning={phase === "rolling"} justLanded={phase === "settled"} />
        ))}
      </div>

      {phase === "settled" && (
        <button
          onClick={onConfirm}
          className="anim-press absolute inset-0 flex items-end justify-center pb-1 text-xs font-medium text-zinc-500"
        >
          <span className="anim-bounce rounded-full border-b-4 border-fuchsia-900 bg-gradient-to-b from-game-pink to-fuchsia-600 px-4 py-1.5 text-sm font-bold text-white shadow-[var(--game-shadow-sm)]">
            タップして目を確定!
          </span>
        </button>
      )}
    </div>
  );
}
