// 駅の実際の地理座標データが無いため、接続関係(edges)だけから見やすい配置を
// 自動計算する(いわゆる路線図と同じく、地理的正確さより「繋がり」を優先する)。
// 同じ入力(駅・接続関係)であれば常に同じ配置になるよう、乱数は決定的なシードで生成する
// (本部画面は数秒おきに自動更新されるため、毎回レイアウトが揺れると見づらくなるため)。

function hashStringToSeed(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h >>> 0) || 1;
}

function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type StationPos = { id: string; name: string; x: number; y: number };

export function computeStationLayout(
  stations: { id: string; name: string }[],
  edges: { station_a_id: string; station_b_id: string }[],
  width = 1000,
  height = 520
): StationPos[] {
  const n = stations.length;
  if (n === 0) return [];

  const rng = mulberry32(
    hashStringToSeed(
      stations
        .map((s) => s.id)
        .sort()
        .join(",")
    )
  );
  const pos = new Map<string, { x: number; y: number }>();
  stations.forEach((s) => {
    pos.set(s.id, { x: 40 + rng() * (width - 80), y: 40 + rng() * (height - 80) });
  });

  const stationIds = new Set(stations.map((s) => s.id));
  const adjacency: [string, string][] = edges
    .filter((e) => stationIds.has(e.station_a_id) && stationIds.has(e.station_b_id))
    .map((e) => [e.station_a_id, e.station_b_id]);

  const area = width * height;
  const k = Math.sqrt(area / n) * 0.85;
  const iterations = 180;

  for (let iter = 0; iter < iterations; iter++) {
    const disp = new Map<string, { x: number; y: number }>();
    stations.forEach((s) => disp.set(s.id, { x: 0, y: 0 }));

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = stations[i];
        const b = stations[j];
        const pa = pos.get(a.id)!;
        const pb = pos.get(b.id)!;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (k * k) / dist;
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        const da = disp.get(a.id)!;
        da.x += dx;
        da.y += dy;
        const db = disp.get(b.id)!;
        db.x -= dx;
        db.y -= dy;
      }
    }

    for (const [aId, bId] of adjacency) {
      const pa = pos.get(aId)!;
      const pb = pos.get(bId)!;
      let dx = pa.x - pb.x;
      let dy = pa.y - pb.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (dist * dist) / k;
      dx = (dx / dist) * force;
      dy = (dy / dist) * force;
      const da = disp.get(aId)!;
      da.x -= dx;
      da.y -= dy;
      const db = disp.get(bId)!;
      db.x += dx;
      db.y += dy;
    }

    const temp = width * 0.06 * (1 - iter / iterations);
    stations.forEach((s) => {
      const d = disp.get(s.id)!;
      const dist = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01;
      const p = pos.get(s.id)!;
      const capped = Math.min(dist, Math.max(temp, 0.1));
      p.x += (d.x / dist) * capped;
      p.y += (d.y / dist) * capped;
      p.x = Math.min(width - 24, Math.max(24, p.x));
      p.y = Math.min(height - 24, Math.max(24, p.y));
    });
  }

  return stations.map((s) => ({ id: s.id, name: s.name, ...pos.get(s.id)! }));
}
