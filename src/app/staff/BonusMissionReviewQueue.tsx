"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { EVIDENCE_BUCKET } from "@/lib/game/storage";
import { staffBtn } from "./StaffUI";

type ReviewItem = {
  id: string;
  ref_id: string;
  teams: { team_name: string } | null;
  team_bonus_mission_attempts: {
    id: string;
    reward: number;
    title: string | null;
    description: string | null;
    bonus_mission_photos: { id: string; storage_path: string }[];
  } | null;
};

export function BonusMissionReviewQueue({ initialItems }: { initialItems: ReviewItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const supabase = createClient();
    const paths = initialItems.flatMap((i) => i.team_bonus_mission_attempts?.bonus_mission_photos ?? []);
    (async () => {
      const entries = await Promise.all(
        paths.map(async (p) => {
          const { data } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(p.storage_path, 300);
          return [p.storage_path, data?.signedUrl ?? ""] as const;
        })
      );
      setPhotoUrls(Object.fromEntries(entries));
    })();

  }, [initialItems]);

  const [items, setItems] = useState(initialItems);
  const [itemsSnapshot, setItemsSnapshot] = useState(initialItems);
  if (initialItems !== itemsSnapshot) {
    setItemsSnapshot(initialItems);
    setItems(initialItems);
  }

  async function review(attemptId: string, decision: "SUCCESS" | "FAILURE") {
    setBusyId(attemptId);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_review_bonus_mission", { p_bonus_attempt_id: attemptId, p_decision: decision, p_reason: null });
    setBusyId(null);
    if (error) {
      window.alert(error.message);
      return;
    }
    // サーバーの再取得(router.refresh)を待たず、その場で消して即座に反応させる。
    setItems((prev) => prev.filter((it) => it.team_bonus_mission_attempts?.id !== attemptId));
    router.refresh();
  }

  if (items.length === 0) {
    return <p className="text-sm text-zinc-500">現在、判定待ちのボーナスミッションはありません</p>;
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const attempt = item.team_bonus_mission_attempts;
        if (!attempt) return null;
        return (
          <li key={item.id} className="rounded-xl border-2 border-fuchsia-300 bg-fuchsia-50 p-3 dark:bg-fuchsia-950">
            <p className="text-base font-bold">{item.teams?.team_name ?? "-"}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              <span className="font-semibold">{attempt.title ?? "-"}</span>(報酬: {attempt.reward.toLocaleString()}円)
              {attempt.description && (
                <span className="ml-2 whitespace-pre-line text-zinc-500 dark:text-zinc-500">{attempt.description}</span>
              )}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {attempt.bonus_mission_photos.map((p, i) => (
                <a
                  key={p.id}
                  href={photoUrls[p.storage_path] ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-blue-400"
                >
                  📎 ボーナスミッション証拠写真{attempt.bonus_mission_photos.length > 1 ? i + 1 : ""}を開く
                </a>
              ))}
              <button onClick={() => review(attempt.id, "SUCCESS")} disabled={busyId === attempt.id} className={staffBtn.approve}>
                ✅ 成功
              </button>
              <button onClick={() => review(attempt.id, "FAILURE")} disabled={busyId === attempt.id} className={staffBtn.reject}>
                ❌ 失敗
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
