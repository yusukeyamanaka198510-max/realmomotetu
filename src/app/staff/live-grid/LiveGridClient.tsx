"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatYen } from "@/lib/game/format";

export type LiveGridTeam = {
  id: string;
  teamNumber: number;
  teamName: string;
  state:
    | "WAITING"
    | "START_CHECKIN"
    | "START_CHECKIN_REVIEW"
    | "DICE_READY"
    | "ROLLING"
    | "DESTINATION_SELECTION"
    | "TRAVELING"
    | "ARRIVAL_SUBMISSION"
    | "ARRIVAL_REVIEW"
    | "MISSION_SELECTION"
    | "MISSION_ACTIVE"
    | "MISSION_REVIEW"
    | "MISSION_REWARD_CHOICE"
    | "PROPERTY_PURCHASE"
    | "PAUSED"
    | "FINISHED";
  currentStationId: string | null;
  currentStationName: string;
  coinBalance: number;
  totalAssets: number;
  hasBombii: boolean;
  isPaused: boolean;
  isStuck: boolean;
  updatedAgoMinutes: number | null;
};

// チームのスマホ画面に出る「今すべきこと」と同じ文言。チームの操作待ちは青、
// 本部の確認・判定待ちは黄、それ以外(待機・終了)はグレーで一目で区別する。
const ACTION_LABEL: Record<LiveGridTeam["state"], { label: string; tone: "team" | "staff" | "idle" }> = {
  WAITING: { label: "本部の開始を待っています", tone: "idle" },
  START_CHECKIN: { label: "スタート駅で写真を提出する", tone: "team" },
  START_CHECKIN_REVIEW: { label: "本部確認中…", tone: "staff" },
  DICE_READY: { label: "サイコロを振る", tone: "team" },
  ROLLING: { label: "サイコロを振る", tone: "team" },
  DESTINATION_SELECTION: { label: "移動する駅を選ぶ", tone: "team" },
  TRAVELING: { label: "到着を報告する", tone: "team" },
  ARRIVAL_SUBMISSION: { label: "到着証拠を提出する", tone: "team" },
  ARRIVAL_REVIEW: { label: "本部確認中…", tone: "staff" },
  MISSION_SELECTION: { label: "ミッションを選ぶ", tone: "team" },
  MISSION_ACTIVE: { label: "証拠写真を提出する", tone: "team" },
  MISSION_REVIEW: { label: "本部判定中…", tone: "staff" },
  MISSION_REWARD_CHOICE: { label: "報酬を選ぶ", tone: "team" },
  PROPERTY_PURCHASE: { label: "物件を見る(任意)", tone: "team" },
  PAUSED: { label: "一時停止中", tone: "idle" },
  FINISHED: { label: "ゲーム終了", tone: "idle" },
};

const TONE_CLASS: Record<"team" | "staff" | "idle", string> = {
  team: "bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  staff: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  idle: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

export function LiveGridClient({ eventId, teams }: { eventId: string; teams: LiveGridTeam[] }) {
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();

    function scheduleRefresh() {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => router.refresh(), 800);
    }

    const channel = supabase
      .channel(`staff-live-grid:${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_state" }, scheduleRefresh)
      .subscribe();

    // Realtime切断時に更新を見逃さないためのフォールバック(他の本部画面と同じ間隔)。
    const interval = setInterval(() => router.refresh(), 4000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [eventId, router]);

  return (
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
      {teams.map((t) => {
        const action = ACTION_LABEL[t.state];
        return (
          <div
            key={t.id}
            className={`rounded-xl border-2 bg-white p-3 shadow-sm dark:bg-zinc-900 ${
              t.isStuck ? "border-red-500" : "border-zinc-200 dark:border-zinc-800"
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <p className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-50">
                {t.teamNumber}. {t.teamName}
              </p>
              {t.hasBombii && (
                <span className="shrink-0 text-lg" title="ボンビー憑依中">
                  😈
                </span>
              )}
            </div>

            <p className={`mt-1.5 rounded-lg px-2 py-1.5 text-xs font-bold leading-snug ${TONE_CLASS[action.tone]}`}>
              {action.label}
            </p>

            <p className="mt-1.5 truncate text-lg font-black text-zinc-900 dark:text-zinc-50">📍{t.currentStationName}</p>
            <p className="mt-0.5 font-mono text-sm font-bold tabular-nums text-zinc-800 dark:text-zinc-100">
              {formatYen(t.totalAssets)}
            </p>

            <div className="mt-1.5 flex flex-wrap gap-1">
              {t.isPaused && (
                <span className="rounded bg-zinc-500 px-1.5 py-0.5 text-[10px] font-bold text-white">一時停止</span>
              )}
              {t.isStuck && (
                <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  要確認({t.updatedAgoMinutes}分)
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
