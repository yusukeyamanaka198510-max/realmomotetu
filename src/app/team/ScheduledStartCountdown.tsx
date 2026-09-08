"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function formatCountdown(ms: number): string {
  if (ms <= 0) return "まもなく開始";
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

export function ScheduledStartCountdown({ scheduledStartAt }: { scheduledStartAt: string | null }) {
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- マウント直後に実時刻へ同期するための初回セット
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // 自動開始が予約されている場合、この待機画面自身がポーリングして開始時刻を過ぎたら
  // 自動的にイベントを開始する(本部がボタンを押さなくても始まるようにするため)。
  useEffect(() => {
    const supabase = createClient();
    const check = () => {
      supabase.rpc("fn_maybe_auto_start_event").then(() => router.refresh());
    };
    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, [router]);

  if (!scheduledStartAt) {
    return <p className="mt-3 text-sm font-bold text-white/80">本部の開始をお待ちください</p>;
  }

  const targetMs = new Date(scheduledStartAt).getTime();
  const remainingMs = now !== null ? targetMs - now : null;

  return (
    <>
      <p className="mt-3 text-lg font-bold text-game-gold">
        {new Date(scheduledStartAt).toLocaleString("ja-JP", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        から開始します
      </p>
      <p className="mt-4 font-mono text-5xl font-black tabular-nums text-white">
        {remainingMs === null ? " " : formatCountdown(remainingMs)}
      </p>
    </>
  );
}
