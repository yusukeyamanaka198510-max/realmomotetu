"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// 到着/ミッション/スタートチェックイン/ボーナスミッションの各承認キューは同じ
// review_queueテーブルを共有しているが、以前は4つのコンポーネントがそれぞれ個別に
// postgres_changes購読+4秒ポーリングでrouter.refresh()を呼んでいた。そのため
// チームが1件提出するだけで本部ダッシュボード全体(ヘッダーのナビリンク等を含む)が
// 最大4回ほぼ同時に再レンダリングされ、ライブイベント中の活発な提出頻度と相まって
// リンクのクリックが効きにくくなる不具合があった。1箇所に集約し、短時間の連続発火は
// デバウンスしてrouter.refresh()の呼び出し回数を最小限にする。
export function StaffAutoRefresh({ eventId }: { eventId: string }) {
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();

    function scheduleRefresh() {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => router.refresh(), 500);
    }

    const channel = supabase
      .channel(`staff-review-queue:${eventId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "review_queue", filter: `event_id=eq.${eventId}` },
        scheduleRefresh
      )
      .subscribe();

    // Realtime切断時に新着提出を見逃さないためのフォールバック(本部が気づけないと現場が
    // 詰まってしまうため、承認キューは特に切断への耐性を持たせる)。
    const interval = setInterval(() => router.refresh(), 4000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [eventId, router]);

  return null;
}
