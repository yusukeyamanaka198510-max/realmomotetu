import type { ReactNode } from "react";

// 本部画面全体で使う共通のボタンスタイル。承認/却下など押す頻度が高い操作を
// 大きく・押しやすく・色でひと目で分かるようにする。
export const staffBtn = {
  approve:
    "rounded-xl bg-emerald-600 px-5 py-3 text-base font-bold text-white shadow-md transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50 disabled:active:scale-100",
  reject:
    "rounded-xl bg-red-600 px-5 py-3 text-base font-bold text-white shadow-md transition hover:bg-red-700 active:scale-95 disabled:opacity-50 disabled:active:scale-100",
  primary:
    "rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-blue-700 active:scale-95 disabled:opacity-50 disabled:active:scale-100",
  neutral:
    "rounded-xl border-2 border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 active:scale-95 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200",
  danger:
    "rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-red-700 active:scale-95 disabled:opacity-50",
} as const;

// 各セクションを見出し+件数バッジ付きのカードでまとめ、優先度(触る頻度)が
// ひと目で分かるようにする共通ラッパー。
export function StaffSection({
  icon,
  title,
  count,
  accent = "zinc",
  children,
}: {
  icon: string;
  title: string;
  count?: number;
  accent?: "amber" | "sky" | "fuchsia" | "emerald" | "zinc" | "indigo";
  children: ReactNode;
}) {
  const accentBorder: Record<string, string> = {
    amber: "border-amber-300 dark:border-amber-800",
    sky: "border-sky-300 dark:border-sky-800",
    fuchsia: "border-fuchsia-300 dark:border-fuchsia-800",
    emerald: "border-emerald-300 dark:border-emerald-800",
    indigo: "border-indigo-300 dark:border-indigo-800",
    zinc: "border-zinc-200 dark:border-zinc-800",
  };
  return (
    <section className={`mt-6 rounded-2xl border-2 bg-white p-4 shadow-sm dark:bg-zinc-900 ${accentBorder[accent]}`}>
      <div className="flex items-center gap-2">
        <span className="text-xl">{icon}</span>
        <h2 className="text-base font-bold">{title}</h2>
        {!!count && (
          <span className="ml-1 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">{count}件</span>
        )}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}
