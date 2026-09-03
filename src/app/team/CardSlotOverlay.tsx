"use client";

import { useEffect, useState } from "react";
import { CARD_RARITY_LABELS, type CardRarity } from "@/lib/game/types";

type CardNotification = { id: string; message: string; created_at: string };

const DECOY_NAMES = ["急行カード", "牛歩カード", "宝くじカード", "半額カード", "絶好調カード", "カードバリア"];

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

function parseCardNotification(message: string): { name: string; rarity: CardRarity } | null {
  const match = /^🎴CARD:(.+):(NORMAL|RARE|SUPER_RARE)$/.exec(message);
  if (!match) return null;
  return { name: match[1], rarity: match[2] as CardRarity };
}

export function CardSlotOverlay({ notifications }: { notifications: CardNotification[] }) {
  const [active, setActive] = useState<{ name: string; rarity: CardRarity } | null>(null);
  const [spinning, setSpinning] = useState(true);
  const [reelText, setReelText] = useState(DECOY_NAMES[0]);

  // 通知配列は再レンダリングのたびに新しい参照になりうるため、実質的な内容(最新のカード通知ID)
  // だけをeffectの依存にする。配列そのものを依存にすると無関係な再レンダリングで演出が中断されてしまう。
  // (以前はuseRefで「既に処理済みか」を追加ガードしていたが、React StrictModeの開発時二重実行で
  //  1回目の実行が作ったタイマーがクリーンアップされた後、refの値だけが残ってしまい、
  //  2回目の実行が早期returnしてタイマーが二度と始まらない不具合になっていた。
  //  依存配列だけで十分なので、冗長なrefガードは持たない。)
  const latestCardNotif = notifications.find((n) => parseCardNotification(n.message)) ?? null;
  const latestCardNotifId = latestCardNotif?.id ?? null;

  useEffect(() => {
    if (!latestCardNotifId) return;
    const parsed = latestCardNotif ? parseCardNotification(latestCardNotif.message) : null;
    if (!parsed) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- 新着通知検知に応じた意図的な演出開始
    setActive(parsed);
    setSpinning(true);

    let ticks = 0;
    const spinInterval = setInterval(() => {
      setReelText(DECOY_NAMES[Math.floor(Math.random() * DECOY_NAMES.length)]);
      ticks += 1;
      if (ticks > 8) {
        clearInterval(spinInterval);
        setSpinning(false);
      }
    }, 90);

    const dismissTimer = setTimeout(() => setActive(null), 3400);
    return () => {
      clearInterval(spinInterval);
      clearTimeout(dismissTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- latestCardNotifが変わる時は必ずlatestCardNotifIdも変わるため十分
  }, [latestCardNotifId]);

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 motion-reduce:transition-none" role="status">
      <div
        className={`w-64 rounded-[var(--game-radius-lg)] border-4 bg-white p-5 text-center shadow-[var(--game-shadow-lg)] transition-transform dark:bg-zinc-900 ${
          spinning ? RARITY_RING.NORMAL : `${RARITY_RING[active.rarity]} anim-pop`
        }`}
      >
        <p className="text-xs font-bold uppercase tracking-wide text-game-purple">🎴カード獲得!</p>
        <div className="mt-3 flex h-16 items-center justify-center overflow-hidden rounded-xl bg-zinc-100 px-2 dark:bg-zinc-800">
          <p className={`font-bold ${spinning ? "text-zinc-400 blur-[1px]" : "text-lg text-zinc-900 dark:text-zinc-50"}`}>
            {spinning ? reelText : active.name}
          </p>
        </div>
        {!spinning && (
          <span className={`mt-3 inline-block rounded-full px-3 py-1 text-xs font-bold ${RARITY_BG[active.rarity]}`}>
            {CARD_RARITY_LABELS[active.rarity]}
          </span>
        )}
      </div>
    </div>
  );
}
