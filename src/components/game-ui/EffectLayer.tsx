"use client";

import { useEffect, useState } from "react";

const CONFETTI_COLORS = ["#ef4444", "#f5a623", "#ffd93d", "#22c55e", "#3b82f6", "#9333ea", "#ff6fa5"];

type ConfettiPiece = { id: number; left: number; delay: number; duration: number; rotate: number; color: string };

export function ConfettiBurst({ count = 28 }: { count?: number }) {
  const [pieces, setPieces] = useState<ConfettiPiece[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- マウント時に一度だけ乱数配置を確定する意図的な初期化
    setPieces(
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.4,
        duration: 1.4 + Math.random() * 1,
        rotate: Math.floor(Math.random() * 360),
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      }))
    );
  }, [count]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="anim-confetti-fall absolute top-[-8%] h-2.5 w-1.5 rounded-sm"
          style={{
            left: `${p.left}%`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            background: p.color,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}

export function SpeedLines() {
  return (
    <div
      className="anim-speedlines pointer-events-none fixed inset-0 z-[55]"
      style={{
        background:
          "repeating-conic-gradient(from 0deg, rgba(255,255,255,0.9) 0deg 3deg, transparent 3deg 11deg)",
        maskImage: "radial-gradient(circle, transparent 12%, black 62%)",
        WebkitMaskImage: "radial-gradient(circle, transparent 12%, black 62%)",
      }}
      aria-hidden="true"
    />
  );
}

type Sparkle = { id: number; top: number; left: number; delay: number };

export function SparkleField({ count = 10 }: { count?: number }) {
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- マウント時に一度だけ乱数配置を確定する意図的な初期化
    setSparkles(
      Array.from({ length: count }, (_, i) => ({
        id: i,
        top: 10 + Math.random() * 80,
        left: 10 + Math.random() * 80,
        delay: Math.random() * 1,
      }))
    );
  }, [count]);

  return (
    <div className="pointer-events-none absolute inset-0 z-[58] overflow-hidden" aria-hidden="true">
      {sparkles.map((s) => (
        <span
          key={s.id}
          className="anim-sparkle absolute text-lg"
          style={{ top: `${s.top}%`, left: `${s.left}%`, animationDelay: `${s.delay}s` }}
        >
          ✨
        </span>
      ))}
    </div>
  );
}
