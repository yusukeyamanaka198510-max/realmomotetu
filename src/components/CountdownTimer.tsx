"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "終了";
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `残り ${h}時間${String(m).padStart(2, "0")}分`;
  if (m > 0) return `残り ${m}分${String(s).padStart(2, "0")}秒`;
  return `残り ${s}秒`;
}

export function CountdownTimer({ eventId, endAt, status }: { eventId: string; endAt: string | null; status: string }) {
  const router = useRouter();
  // サーバー側の初回レンダリングとクライアントのhydrationでDate.now()の値がずれてhydration mismatch
  // を起こさないよう、マウント後(useEffect内)にだけ実時刻を計算する。
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- マウント直後に実時刻へ同期するための初回セット
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`event_status:${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "events", filter: `id=eq.${eventId}` }, () => router.refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, router]);

  const isEnded = status === "FORCE_ENDED" || status === "ENDED";
  const remainingMs = endAt && now !== null ? new Date(endAt).getTime() - now : null;
  const isOver = isEnded || (remainingMs !== null && remainingMs <= 0);
  const isUrgent = !isOver && remainingMs !== null && remainingMs < 5 * 60 * 1000;

  if (status === "SCHEDULED") {
    return (
      <div className="rounded bg-zinc-100 px-3 py-2 text-center text-sm font-medium text-zinc-500 dark:bg-zinc-900">開始前です</div>
    );
  }

  return (
    <div
      className={`rounded px-3 py-2 text-center text-sm font-bold ${
        isOver ? "bg-zinc-700 text-white" : isUrgent ? "animate-pulse bg-red-600 text-white" : "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
      }`}
    >
      {now === null ? " " : isOver ? "ゲーム終了" : formatRemaining(remainingMs ?? 0)}
    </div>
  );
}
