import type { ReactNode } from "react";

type GameBadgeTone = "red" | "gold" | "green" | "purple" | "blue" | "navy";

const TONE_CLASS: Record<GameBadgeTone, string> = {
  red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  gold: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  purple: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  navy: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
};

export function GameBadge({ tone = "navy", children }: { tone?: GameBadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${TONE_CLASS[tone]}`}>{children}</span>
  );
}
