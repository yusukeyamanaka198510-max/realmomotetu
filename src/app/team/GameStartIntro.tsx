"use client";

import { useEffect, useState } from "react";
import { GameText, SparkleField } from "@/components/game-ui";

const STORAGE_KEY = "momotetsu-intro-shown-v1";

export function GameStartIntro({ isRunning }: { isRunning: boolean }) {
  const [visible, setVisible] = useState(false);
  // sessionStorageの読み取りはマウント時に一度だけ確定させる(StrictModeの開発時二重実行で
  // 1回目のeffectがフラグを書き込んだ直後に2回目のeffectがそれを読んで早期returnし、
  // 演出を開始したまま非表示タイマーが二度と走らなくなる不具合を避けるため)。
  const [shouldPlayThisMount] = useState(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY) !== "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!isRunning || !shouldPlayThisMount) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // storageが使えない環境ではフラグを保存できないだけで、演出自体には影響しない
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初回のゲーム開始検知に応じた意図的な演出開始
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 2600);
    return () => clearTimeout(timer);
  }, [isRunning, shouldPlayThisMount]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-game-navy via-slate-900 to-black">
      <SparkleField count={14} />
      <div className="anim-pop relative text-center">
        <p className="text-5xl">🚃</p>
        <GameText as="h1" variant="title" className="mt-2 block">
          リアル桃鉄
        </GameText>
        <p className="mt-1 text-sm font-bold text-white/70">2026年9月の陣</p>
      </div>
      <p className="anim-slam game-text-event mt-8 text-4xl" style={{ animationDelay: "900ms", animationFillMode: "backwards" }}>
        GAME START!
      </p>
    </div>
  );
}
