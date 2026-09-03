"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { EVIDENCE_BUCKET } from "@/lib/game/storage";

type ReviewItem = {
  id: string;
  ref_id: string;
  teams: { team_name: string } | null;
  arrival_submissions: {
    id: string;
    submitted_at: string;
    station: { name: string } | null;
    arrival_photos: { id: string; storage_path: string }[];
  } | null;
};

export function ArrivalReviewQueue({
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
      .channel(`review_queue:${eventId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "review_queue", filter: `event_id=eq.${eventId}` },
        () => router.refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, router]);

  useEffect(() => {
    const supabase = createClient();
    const paths = initialItems.flatMap((i) => i.arrival_submissions?.arrival_photos ?? []);
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

  async function review(arrivalSubmissionId: string, decision: "APPROVE" | "REJECT") {
    let reason: string | null = null;
    if (decision === "REJECT") {
      reason = window.prompt("却下理由を入力してください");
      if (reason === null) return;
    }
    setBusyId(arrivalSubmissionId);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_review_arrival", {
      p_arrival_submission_id: arrivalSubmissionId,
      p_decision: decision,
      p_reason: reason,
    });
    setBusyId(null);
    if (error) {
      window.alert(error.message);
      return;
    }
    router.refresh();
  }

  if (initialItems.length === 0) {
    return <p className="mt-2 text-sm text-zinc-500">現在、確認待ちの到着報告はありません</p>;
  }

  return (
    <ul className="mt-2 space-y-4">
      {initialItems.map((item) => {
        const arrival = item.arrival_submissions;
        if (!arrival) return null;
        return (
          <li key={item.id} className="rounded border border-amber-300 bg-amber-50 p-4 dark:bg-amber-950">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{item.teams?.team_name ?? "-"}</p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  到着予定駅: {arrival.station?.name ?? "-"} / 提出: {new Date(arrival.submitted_at).toLocaleString("ja-JP")}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => review(arrival.id, "APPROVE")}
                  disabled={busyId === arrival.id}
                  className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  承認
                </button>
                <button
                  onClick={() => review(arrival.id, "REJECT")}
                  disabled={busyId === arrival.id}
                  className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  却下
                </button>
              </div>
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto">
              {arrival.arrival_photos.map((p) => (
                <a key={p.id} href={photoUrls[p.storage_path] ?? "#"} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoUrls[p.storage_path] ?? ""}
                    alt="到着証拠写真"
                    className="h-24 w-24 rounded object-cover"
                  />
                </a>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
