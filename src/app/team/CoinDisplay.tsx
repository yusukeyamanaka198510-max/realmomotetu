"use client";

import { useEffect, useRef, useState } from "react";

type FloatEvent = { id: number; diff: number };

let floatIdCounter = 0;

export function CoinDisplay({ balance }: { balance: number }) {
  const prevBalance = useRef<number | null>(null);
  const [floats, setFloats] = useState<FloatEvent[]>([]);

  useEffect(() => {
    if (prevBalance.current === null) {
      prevBalance.current = balance;
      return;
    }
    const diff = balance - prevBalance.current;
    prevBalance.current = balance;
    if (diff === 0) return;

    const id = ++floatIdCounter;
    setFloats((prev) => [...prev, { id, diff }]);
    setTimeout(() => {
      setFloats((prev) => prev.filter((f) => f.id !== id));
    }, 1800);
  }, [balance]);

  return (
    <div className={`relative rounded-xl bg-gradient-to-b from-amber-50 to-amber-100 px-3 py-2 dark:from-amber-950 dark:to-amber-900 ${floats.length > 0 ? "anim-flash" : ""}`}>
      <p className="text-[11px] font-bold text-amber-700 dark:text-amber-300">🪙所持コイン</p>
      <p className="text-lg font-black tabular-nums text-game-gold [text-shadow:0_1px_0_rgba(0,0,0,0.15)]">{balance.toLocaleString()}</p>
      <div className="pointer-events-none absolute right-2 top-0 flex flex-col items-end">
        {floats.map((f) => (
          <span key={f.id} className={`anim-float text-sm font-extrabold ${f.diff > 0 ? "text-emerald-600" : "text-game-red"}`}>
            {f.diff > 0 ? "+" : ""}
            {f.diff.toLocaleString()}
          </span>
        ))}
      </div>
    </div>
  );
}
