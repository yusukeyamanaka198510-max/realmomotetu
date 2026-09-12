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
  team_start_checkins: {
    id: string;
    submitted_at: string;
    station: { name: string } | null;
    start_checkin_photos: { id: string; storage_path: string }[];
  } | null;
};

export function StartCheckinReviewQueue({
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
      .channel(`start_checkin_queue:${eventId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "review_queue", filter: `event_id=eq.${eventId}` },
        () => router.refresh()
      )
      .subscribe();
    const interval = setInterval(() => router.refresh(), 15000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [eventId, router]);

  useEffect(() => {
    const supabase = createClient();
    const paths = initialItems.flatMap((i) => i.team_start_checkins?.start_checkin_photos ?? []);
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

  async function review(startCheckinId: string, decision: "APPROVE" | "REJECT") {
    let reason: string | null = null;
    if (decision === "REJECT") {
      reason = window.prompt("却下理由を入力してください");
      if (reason === null) return;
    }
    setBusyId(startCheckinId);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_review_start_checkin", {
      p_start_checkin_id: startCheckinId,
      p_decision: decision,
      p_reason: reason,
    });
    setBusyId(null);
    if (error) {
      window.alert(error.message);
      return;
    }
    setItems((prev) => prev.filter((it) => it.team_start_checkins?.id !== startCheckinId));
    router.refresh();
  }

  if (items.length === 0) {
    return <p className="text-sm text-zinc-500">現在、確認待ちのスタートチェックインはありません</p>;
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const checkin = item.team_start_checkins;
        if (!checkin) return null;
        return (
          <li key={item.id} className="rounded-xl border-2 border-sky-300 bg-sky-50 p-3 dark:bg-sky-950">
            <p className="text-base font-bold">{item.teams?.team_name ?? "-"}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              スタート駅: {checkin.station?.name ?? "-"} / 提出: {new Date(checkin.submitted_at).toLocaleString("ja-JP")}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {checkin.start_checkin_photos.map((p, i) => (
                <a
                  key={p.id}
                  href={photoUrls[p.storage_path] ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-blue-400"
                >
                  📎 チェックイン写真{checkin.start_checkin_photos.length > 1 ? i + 1 : ""}を開く
                </a>
              ))}
              <button onClick={() => review(checkin.id, "APPROVE")} disabled={busyId === checkin.id} className={staffBtn.approve}>
                ✅ 承認
              </button>
              <button onClick={() => review(checkin.id, "REJECT")} disabled={busyId === checkin.id} className={staffBtn.reject}>
                ❌ 却下
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
