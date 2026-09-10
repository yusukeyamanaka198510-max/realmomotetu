import { redirect } from "next/navigation";
import Link from "next/link";
import { getActor } from "@/lib/game/actor";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { EVIDENCE_BUCKET } from "@/lib/game/storage";
import { RetrospectiveClient, type RetrospectiveEvent, type RetrospectiveTeam } from "./RetrospectiveClient";

type RawEvent = {
  team_id: string;
  at: string;
  kind: RetrospectiveEvent["kind"];
  detail: Record<string, unknown>;
  photos: string[];
};

export default async function RetrospectivePage() {
  const actor = await getActor();
  if (actor.kind !== "team" && actor.kind !== "staff") redirect("/login");

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

  const allPaths = Array.from(new Set(rawEvents.flatMap((e) => e.photos ?? [])));
  const signedUrlByPath = new Map<string, string>();
  if (allPaths.length > 0) {
    const admin = createAdminClient();
    const { data: signed } = await admin.storage.from(EVIDENCE_BUCKET).createSignedUrls(allPaths, 3600);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) signedUrlByPath.set(s.path, s.signedUrl);
    }
  }

  const eventsByTeam = new Map<string, RetrospectiveEvent[]>();
  for (const e of rawEvents) {
    const list = eventsByTeam.get(e.team_id) ?? [];
    list.push({
      at: e.at,
      kind: e.kind,
      detail: e.detail,
      photoUrls: (e.photos ?? []).map((p) => signedUrlByPath.get(p)).filter((u): u is string => !!u),
    });
    eventsByTeam.set(e.team_id, list);
  }

  const backHref = actor.kind === "staff" ? "/staff" : "/team";

  return (
    <div className="min-h-dvh bg-cover bg-top bg-fixed" style={{ backgroundImage: "url(/board-illustration.webp)" }}>
      <div className="min-h-dvh bg-white/60 dark:bg-slate-950/75">
        <div className="mx-auto max-w-2xl space-y-4 p-6">
          <Link href={backHref} className="text-sm text-zinc-500 hover:underline">
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
