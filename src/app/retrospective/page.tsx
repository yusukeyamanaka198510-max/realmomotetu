import { redirect } from "next/navigation";
import Link from "next/link";
import { getActor } from "@/lib/game/actor";
import { createClient } from "@/lib/supabase/server";
import { RetrospectiveClient, type RetrospectiveEvent, type RetrospectiveTeam } from "./RetrospectiveClient";

type RawEvent = {
  team_id: string;
  at: string;
  kind: RetrospectiveEvent["kind"];
  detail: Record<string, unknown>;
};

export default async function RetrospectivePage() {
  const actor = await getActor();
  // 参加者の顔写真・却下理由・ボンビー付与記録などを含むため、本部限定にしている。
  if (actor.kind !== "staff") redirect("/login");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_retrospective_timeline");
  if (error) {
    return (
      <div className="mx-auto max-w-md p-6">
        <p className="text-sm text-red-600">振り返りデータの取得に失敗しました: {error.message}</p>
      </div>
    );
  }

  const teams = ((data?.teams ?? []) as RetrospectiveTeam[]).slice();
  const rawEvents = (data?.events ?? []) as RawEvent[];

  // どのチームの出来事かをその場で当てるコーナーのため、写真は表示しない(顔写真等で先にバレてしまう)。
  const eventsByTeam = new Map<string, RetrospectiveEvent[]>();
  for (const e of rawEvents) {
    const list = eventsByTeam.get(e.team_id) ?? [];
    list.push({ at: e.at, kind: e.kind, detail: e.detail });
    eventsByTeam.set(e.team_id, list);
  }

  return (
    <div className="min-h-dvh bg-cover bg-top bg-fixed" style={{ backgroundImage: "url(/board-illustration.webp)" }}>
      <div className="min-h-dvh bg-white/60 dark:bg-slate-950/75">
        <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-10">
          <Link href="/staff" className="text-lg text-zinc-500 hover:underline">
            ← TOPに戻る
          </Link>
          <RetrospectiveClient
            eventId={actor.eventId}
            teams={teams}
            eventsByTeamId={Object.fromEntries(eventsByTeam)}
          />
        </div>
      </div>
    </div>
  );
}
