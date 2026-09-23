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
  team_mission_attempts: {
    id: string;
    attempt_number: number;
    mission: { title: string; description: string } | null;
    mission_photos: { id: string; storage_path: string }[];
  } | null;
};

export function MissionReviewQueue({
  eventId,
  initialItems,
}: {
  eventId: string;
  initialItems: ReviewItem[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`mission_review_queue:${eventId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "review_queue", filter: `event_id=eq.${eventId}` },
        () => router.refresh()
      )
      .subscribe();
    // Realtime切断時に新着提出を見逃さないためのフォールバック。
    const interval = setInterval(() => router.refresh(), 4000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [eventId, router]);

  useEffect(() => {
    const supabase = createClient();
    const paths = initialItems.flatMap((i) => i.team_mission_attempts?.mission_photos ?? []);
    (async () => {
      const entries = await Promise.all(
        paths.map(async (p) => {
          const { data } = await supabase.storage
            .from(EVIDENCE_BUCKET)
            .createSignedUrl(p.storage_path, 300);
          return [p.storage_path, data?.signedUrl ?? ""] as const;
        })
      );
      setPhotoUrls(Object.fromEntries(entries));
    })();
     
  }, [initialItems]);

  const [items, setItems] = useState(initialItems);
  useEffect(() => setItems(initialItems), [initialItems]);

  async function review(attemptId: string, decision: "SUCCESS" | "FAILURE") {
    let reason: string | null = null;
    if (decision === "FAILURE") {
      reason = window.prompt("失敗理由を入力してください");
      if (reason === null) return;
    }
    setBusyId(attemptId);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_review_mission", {
      p_attempt_id: attemptId,
      p_decision: decision,
      p_reason: reason,
    });
    setBusyId(null);
    if (error) {
      window.alert(error.message);
      return;
    }
    // サーバーの再取得(router.refresh)を待たず、その場で消して即座に反応させる。
    setItems((prev) => prev.filter((it) => it.team_mission_attempts?.id !== attemptId));
    router.refresh();
  }

  if (items.length === 0) {
    return <p className="text-sm text-zinc-500">現在、判定待ちのミッションはありません</p>;
  }

  return (
    <div>
      <p className="mb-2 text-xs text-zinc-500">共通の判定基準: 駅名が読める／チーム4人全員が写る</p>
      <ul className="space-y-3">
        {items.map((item) => {
          const attempt = item.team_mission_attempts;
          if (!attempt) return null;
          // 判定基準部分は全ミッション共通のため、上の注記1回だけで足りる。ここでは課題本文だけ表示する。
          const taskText = attempt.mission?.description.split("【判定基準】")[0].trim() ?? "";
          return (
            <li key={item.id} className="rounded-xl border-2 border-sky-300 bg-sky-50 p-3 dark:bg-sky-950">
              <p className="text-base font-bold">
                {item.teams?.team_name ?? "-"}
                {attempt.attempt_number > 1 && (
                  <span className="ml-2 text-xs font-normal text-zinc-500">{attempt.attempt_number}回目の挑戦</span>
                )}
              </p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                <span className="font-semibold">{attempt.mission?.title ?? "-"}</span>
                {taskText && <span className="ml-2 whitespace-pre-line text-zinc-500 dark:text-zinc-500">{taskText}</span>}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
              {attempt.mission_photos.map((p, i) => (
                <a
                  key={p.id}
                  href={photoUrls[p.storage_path] ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-blue-400"
                >
                  📎 ミッション証拠写真{attempt.mission_photos.length > 1 ? i + 1 : ""}を開く
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
    </div>
  );
}
