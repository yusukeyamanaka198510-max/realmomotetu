type LogRow = {
  id: string;
  used_at: string;
  result: string;
  card: { name: string } | null;
  team: { team_name: string } | null;
  target_team: { team_name: string } | null;
};

export function CardUsageLogPanel({ logs }: { logs: LogRow[] }) {
  return (
    <div className="mt-8">
      <h2 className="text-lg font-semibold">カード使用ログ(直近30件)</h2>
      {logs.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">まだ使用履歴はありません</p>
      ) : (
        <ul className="mt-2 space-y-1 text-xs">
          {logs.map((l) => (
            <li key={l.id} className="border-b border-zinc-200 py-1 dark:border-zinc-800">
              {new Date(l.used_at).toLocaleTimeString("ja-JP")} — {l.team?.team_name ?? "-"} が「{l.card?.name ?? "-"}」を使用
              {l.target_team && <span> → 対象: {l.target_team.team_name}</span>}
              <span className={`ml-2 ${l.result === "BLOCKED_BY_BARRIER" ? "text-purple-600" : "text-zinc-400"}`}>[{l.result}]</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
