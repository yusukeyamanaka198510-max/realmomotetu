import { computeStationLayout } from "./mapLayout";

type Station = { id: string; name: string };
type Edge = { station_a_id: string; station_b_id: string; line_id: string };

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
const MULTI_TEAM_FILL = "#18181b";

export function LineMap({
  stations,
  edges,
  teamsByStation,
}: {
  stations: Station[];
  edges: Edge[];
  teamsByStation: Record<string, { teamNumber: number; teamName: string }[]>;
}) {
  const width = 1000;
  const height = 520;
  const positioned = computeStationLayout(stations, edges, width, height);
  const posById = new Map(positioned.map((p) => [p.id, p]));

  return (
    <div className="mt-4 rounded-xl border-2 border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">🗺️ 大体の路線図(チームの現在地の目安。地理的な正確さはありません)</p>

      <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 h-auto w-full" role="img" aria-label="路線図と各チームの現在地">
        {edges.map((e) => {
          const a = posById.get(e.station_a_id);
          const b = posById.get(e.station_b_id);
          if (!a || !b) return null;
          return (
            <line
              key={`${e.station_a_id}-${e.station_b_id}-${e.line_id}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="#d4d4d8"
              strokeWidth={1.5}
            />
          );
        })}

        {positioned.map((s) => {
          const teams = teamsByStation[s.id] ?? [];
          if (teams.length === 0) {
            return <circle key={s.id} cx={s.x} cy={s.y} r={2} fill="#d4d4d8" />;
          }
          const fill = teams.length === 1 ? TEAM_COLORS[(teams[0].teamNumber - 1) % TEAM_COLORS.length] : MULTI_TEAM_FILL;
          return (
            <g key={s.id}>
              <circle cx={s.x} cy={s.y} r={13} fill={fill} stroke="#fff" strokeWidth={3} />
              <text
                x={s.x}
                y={s.y - 20}
                textAnchor="middle"
                fontSize={15}
                fontWeight={800}
                fill="#111827"
                stroke="#fff"
                strokeWidth={4}
                strokeLinejoin="round"
                paintOrder="stroke"
              >
                {s.name}
              </text>
              <text x={s.x} y={s.y + 30} textAnchor="middle" fontSize={17} fontWeight={800} stroke="#fff" strokeWidth={4} strokeLinejoin="round" paintOrder="stroke">
                {teams.map((t, i) => (
                  <tspan key={t.teamNumber} fill={TEAM_COLORS[(t.teamNumber - 1) % TEAM_COLORS.length]} dx={i === 0 ? 0 : 3}>
                    {CIRCLED_NUMBERS[(t.teamNumber - 1) % CIRCLED_NUMBERS.length] ?? t.teamNumber}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
