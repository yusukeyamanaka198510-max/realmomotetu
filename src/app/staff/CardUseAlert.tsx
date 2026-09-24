"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { staffBtn } from "./StaffUI";

type Alert = {
  id: string;
  teamName: string;
  cardName: string;
  targetTeamName: string | null;
  message: string;
};

// チームがカードを使った瞬間を本部が見逃さないよう、card_usage_log への新規挿入を
// リアルタイム検知してモーダルで表示する(バリアで防がれた場合等も含め、使用試行は全て通知する)。
export function CardUseAlert({ eventId }: { eventId: string }) {
  const [queue, setQueue] = useState<Alert[]>([]);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`card-use-alert:${eventId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "card_usage_log", filter: `event_id=eq.${eventId}` },
        async (payload) => {
          const inserted = payload.new as { id: string };
          const { data } = await supabase
            .from("card_usage_log")
            .select(
              "id, effect_detail, card:card_id(name), team:team_id(team_name), target_team:target_team_id(team_name)"
            )
            .eq("id", inserted.id)
            .single();
          if (!data) return;
          // @ts-expect-error 1:1リレーションが配列型で推論されるため
          const cardName: string = data.card?.name ?? "";
          // @ts-expect-error 1:1リレーションが配列型で推論されるため
          const teamName: string = data.team?.team_name ?? "";
          // @ts-expect-error 1:1リレーションが配列型で推論されるため
          const targetTeamName: string | null = data.target_team?.team_name ?? null;
          const message = (data.effect_detail as { message?: string } | null)?.message ?? `${cardName}を使用しました。`;
          setQueue((prev) => [...prev, { id: data.id, teamName, cardName, targetTeamName, message }]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId]);

  const current = queue[0] ?? null;
  if (!current) return null;

  return (
    <div role="alertdialog" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-5">
      <div className="w-full max-w-md rounded-2xl border-4 border-amber-400 bg-white p-6 text-center shadow-xl dark:bg-zinc-900">
        <p className="text-5xl">🎴</p>
        <p className="mt-2 text-xl font-bold text-zinc-900 dark:text-zinc-50">{current.teamName} がカードを使用</p>
        <p className="mt-1 text-lg font-black text-amber-700 dark:text-amber-400">{current.cardName}</p>
        {current.targetTeamName && (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">対象: {current.targetTeamName}</p>
        )}
        <p className="mt-3 rounded-lg bg-zinc-50 p-3 text-left text-sm font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          {current.message}
        </p>
        <div className="mt-5">
          <button className={staffBtn.primary} onClick={() => setQueue((prev) => prev.slice(1))}>
            確認しました{queue.length > 1 ? `(残り${queue.length - 1}件)` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
