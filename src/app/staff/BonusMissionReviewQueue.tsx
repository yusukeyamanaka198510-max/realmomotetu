"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { EVIDENCE_BUCKET } from "@/lib/game/storage";

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

export function BonusMissionReviewQueue({ eventId, initialItems }: { eventId: string; initialItems: ReviewItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`bonus_mission_review_queue:${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "review_queue", filter: `event_id=eq.${eventId}` }, () => router.refresh())
      .subscribe();
    // Realtime切断時に新着提出を見逃さないためのフォールバック。
    const interval = setInterval(() => router.refresh(), 15000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [eventId, router]);

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

  async function review(attemptId: string, decision: "SUCCESS" | "FAILURE") {
    setBusyId(attemptId);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_review_bonus_mission", { p_bonus_attempt_id: attemptId, p_decision: decision, p_reason: null });
    setBusyId(null);
    if (error) {
      window.alert(error.message);
      return;
    }
    router.refresh();
  }

  if (initialItems.length === 0) {
    return <p className="mt-2 text-sm text-zinc-500">現在、判定待ちのボーナスミッションはありません</p>;
  }

  return (
    <ul className="mt-2 space-y-4">
      {initialItems.map((item) => {
        const attempt = item.team_bonus_mission_attempts;
        if (!attempt) return null;
        return (
          <li key={item.id} className="rounded border border-fuchsia-300 bg-fuchsia-50 p-4 dark:bg-fuchsia-950">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{item.teams?.team_name ?? "-"}</p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {attempt.title ?? "-"}(報酬: {attempt.reward.toLocaleString()}円)
                </p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {attempt.description ?? ""}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => review(attempt.id, "SUCCESS")} disabled={busyId === attempt.id} className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                  成功
                </button>
                <button onClick={() => review(attempt.id, "FAILURE")} disabled={busyId === attempt.id} className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                  失敗
                </button>
              </div>
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto">
              {attempt.bonus_mission_photos.map((p) => (
                <a key={p.id} href={photoUrls[p.storage_path] ?? "#"} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photoUrls[p.storage_path] ?? ""} alt="ボーナスミッション証拠写真" className="h-24 w-24 rounded object-cover" />
                </a>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
