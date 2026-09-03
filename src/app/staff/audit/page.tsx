import { redirect } from "next/navigation";
import Link from "next/link";
import { getActor } from "@/lib/game/actor";
import { createClient } from "@/lib/supabase/server";

export default async function AuditLogPage() {
  const actor = await getActor();
  if (actor.kind !== "staff") redirect("/login");

  const supabase = await createClient();
  const { data: logs } = await supabase
    .from("audit_log")
    .select("id, action_type, before_value, after_value, reason, created_at, teams:team_id(team_name)")
    .eq("event_id", actor.eventId)
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <Link href="/staff" className="text-sm text-zinc-500 hover:underline">
        ← ダッシュボードに戻る
      </Link>
      <h1 className="mt-2 text-xl font-semibold">Audit Log</h1>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">日時</th>
            <th>操作</th>
            <th>チーム</th>
            <th>理由</th>
            <th>詳細</th>
          </tr>
        </thead>
        <tbody>
          {logs?.map((log) => (
            <tr key={log.id} className="border-b align-top">
              <td className="py-2 whitespace-nowrap">{new Date(log.created_at).toLocaleString("ja-JP")}</td>
              <td className="whitespace-nowrap font-medium">{log.action_type}</td>
              {/* @ts-expect-error 1:1リレーションが配列型で推論されるため */}
              <td className="whitespace-nowrap">{log.teams?.team_name ?? "-"}</td>
              <td>{log.reason ?? "-"}</td>
              <td className="max-w-xs break-all text-xs text-zinc-500">
                {log.before_value ? `before: ${JSON.stringify(log.before_value)} ` : ""}
                {log.after_value ? `after: ${JSON.stringify(log.after_value)}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
