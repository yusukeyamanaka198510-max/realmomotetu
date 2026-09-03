// 路線図表示用: 駅と接続(edges)の情報から、その路線の駅を順番に並べたチェーンを組み立てる。
// 表示専用のベストエフォートなロジックであり、ゲームロジック(到達可能駅の判定等)には使用しない。
// 支線・分岐がある場合は分岐点で片方の枝だけを採用するなど正確な描画にならないことがあるが、
// 見た目上の目安としては十分機能する。

export function buildLineChain(edgeList: { a: string; b: string }[]): string[] {
  if (edgeList.length === 0) return [];

  const adjacency = new Map<string, string[]>();
  for (const { a, b } of edgeList) {
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a)!.push(b);
    adjacency.get(b)!.push(a);
  }

  const endpoint = [...adjacency.entries()].find(([, neighbors]) => neighbors.length === 1);
  const start = endpoint ? endpoint[0] : adjacency.keys().next().value!;

  const chain: string[] = [start];
  const visited = new Set<string>([start]);
  let current = start;

  while (true) {
    const neighbors = adjacency.get(current) ?? [];
    const next = neighbors.find((n) => !visited.has(n));
    if (!next) break;
    chain.push(next);
    visited.add(next);
    current = next;
  }

  return chain;
}
