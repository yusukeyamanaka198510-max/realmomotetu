import { computeStationLayout } from "./mapLayout";

type Line = { id: string; name: string };
type Station = { id: string; name: string };
type Edge = { station_a_id: string; station_b_id: string; line_id: string };

const LINE_COLORS = ["#1f4fa3", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#78716c"];
const TEAM_COLORS = [
  "#e11d48",
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#9333ea",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#ea580c",
  "#4f46e5",
  "#059669",
  "#dc2626",
  "#0284c7",
  "#a16207",
];
const CIRCLED_NUMBERS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫", "⑬", "⑭"];

export function LineMap({
  stations,
  edges,
  lines,
  teamsByStation,
}: {
  stations: Station[];
  edges: Edge[];
  lines: Line[];
  teamsByStation: Record<string, { teamNumber: number; teamName: string }[]>;
}) {
  const width = 1000;
  const height = 520;
  const positioned = computeStationLayout(stations, edges, width, height);
  const posById = new Map(positioned.map((p) => [p.id, p]));
  const lineIndexById = new Map(lines.map((l, i) => [l.id, i % LINE_COLORS.length]));

  return (
    <div className="mt-4 rounded-xl border-2 border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">🗺️ 大体の路線図(現在地の目安。地理的な正確さはありません)</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {lines.map((l) => (
            <span key={l.id} className="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: LINE_COLORS[lineIndexById.get(l.id) ?? 0] }} />
              {l.name}
            </span>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 h-auto w-full" role="img" aria-label="路線図と各チームの現在地">
        {edges.map((e) => {
          const a = posById.get(e.station_a_id);
          const b = posById.get(e.station_b_id);
          if (!a || !b) return null;
          const color = LINE_COLORS[lineIndexById.get(e.line_id) ?? 0];
          return <line key={`${e.station_a_id}-${e.station_b_id}-${e.line_id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={2.5} strokeOpacity={0.6} />;
        })}

        {positioned.map((s) => {
          const teams = teamsByStation[s.id] ?? [];
          const occupied = teams.length > 0;
          return (
            <g key={s.id}>
              <circle cx={s.x} cy={s.y} r={occupied ? 7 : 3.5} fill={occupied ? "#111827" : "#a1a1aa"} stroke="#fff" strokeWidth={occupied ? 2 : 1} />
              <text x={s.x} y={s.y - (occupied ? 12 : 7)} textAnchor="middle" fontSize={occupied ? 12 : 8} fontWeight={occupied ? 700 : 400} fill={occupied ? "#111827" : "#71717a"}>
                {s.name}
              </text>
              {occupied && (
                <text x={s.x} y={s.y + 20} textAnchor="middle" fontSize={13} fontWeight={700}>
                  {teams.map((t, i) => (
                    <tspan key={t.teamNumber} fill={TEAM_COLORS[(t.teamNumber - 1) % TEAM_COLORS.length]} dx={i === 0 ? 0 : 2}>
                      {CIRCLED_NUMBERS[(t.teamNumber - 1) % CIRCLED_NUMBERS.length] ?? t.teamNumber}
                    </tspan>
                  ))}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
