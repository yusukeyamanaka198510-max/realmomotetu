"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { buildLineChain } from "@/lib/game/lineChains";
import { StationMapPicker } from "./StationMapPicker";

type Station = { id: string; name: string };
type Line = { id: string; name: string };
type Edge = { station_a_id: string; station_b_id: string; line_id: string };
type Card = { id: string; card_code: string; name: string; category: string; rarity: string; enabled: boolean };
type PoolEntry = { id: string; station_id: string; card_id: string; is_active: boolean };
type RarityWeight = { rarity: string; weight: number };

export function CardsManager({
  stations,
  lines,
  edges,
  cards,
  pool,
  rarityWeights,
  cardAcquisitionEnabled,
}: {
  stations: Station[];
  lines: Line[];
  edges: Edge[];
  cards: Card[];
  pool: PoolEntry[];
  rarityWeights: RarityWeight[];
  cardAcquisitionEnabled: boolean;
}) {
  const router = useRouter();
  const [stationId, setStationId] = useState(stations[0]?.id ?? "");
  const [selectedLineId, setSelectedLineId] = useState("");
  const [busy, setBusy] = useState(false);
  const [weights, setWeights] = useState<Record<string, number>>(
    Object.fromEntries(rarityWeights.map((w) => [w.rarity, w.weight]))
  );

  const customizedStationIds = useMemo(
    () => new Set(pool.filter((p) => p.is_active).map((p) => p.station_id)),
    [pool]
  );

  const lineChains = useMemo(
    () =>
      lines.map((l) => ({
        id: l.id,
        name: l.name,
        stationIds: buildLineChain(edges.filter((e) => e.line_id === l.id).map((e) => ({ a: e.station_a_id, b: e.station_b_id }))),
      })),
    [lines, edges]
  );

  async function toggleAcquisition() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_admin_set_card_acquisition_enabled", { p_enabled: !cardAcquisitionEnabled });
    setBusy(false);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  const stationPoolCardIds = new Set(pool.filter((p) => p.station_id === stationId && p.is_active).map((p) => p.card_id));

  async function toggleCard(cardId: string, enabled: boolean) {
    setBusy(true);
    const supabase = createClient();
    const existing = pool.find((p) => p.station_id === stationId && p.card_id === cardId);
    let error;
    if (enabled) {
      if (existing) {
        ({ error } = await supabase.from("station_card_pool").update({ is_active: true }).eq("id", existing.id));
      } else {
        ({ error } = await supabase.from("station_card_pool").insert({ station_id: stationId, card_id: cardId, is_active: true }));
      }
    } else if (existing) {
      ({ error } = await supabase.from("station_card_pool").update({ is_active: false }).eq("id", existing.id));
    } else {
      // この駅がまだ未設定(=全カード対象)の状態で1枚だけ外す場合、他の全カードを
      // active行として明示的に作成することで「このカードだけ対象外」の絞り込みにする。
      const otherCardIds = cards.filter((c) => c.id !== cardId).map((c) => c.id);
      ({ error } = await supabase
        .from("station_card_pool")
        .insert(otherCardIds.map((id) => ({ station_id: stationId, card_id: id, is_active: true }))));
    }
    setBusy(false);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  async function toggleCardEnabled(card: Card) {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.from("cards").update({ enabled: !card.enabled }).eq("id", card.id);
    setBusy(false);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  async function saveWeight(rarity: string) {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("fn_admin_set_rarity_weight", { p_rarity: rarity, p_weight: weights[rarity] ?? 0 });
    setBusy(false);
    if (error) return window.alert(error.message);
    router.refresh();
  }

  const poolIsEmpty = pool.filter((p) => p.station_id === stationId).length === 0;

  async function applyToWholeLine() {
    const line = lineChains.find((l) => l.id === selectedLineId);
    if (!line) return;
    const otherStationIds = line.stationIds.filter((sid) => sid !== stationId);
    if (
      !window.confirm(`「${line.name}」の他の${otherStationIds.length}駅すべてに、現在の${stations.find((s) => s.id === stationId)?.name ?? ""}と同じカード設定を適用しますか?`)
    )
      return;

    setBusy(true);
    const supabase = createClient();
    const activeCardIds = poolIsEmpty ? cards.map((c) => c.id) : [...stationPoolCardIds];
    for (const sid of otherStationIds) {
      await supabase.from("station_card_pool").delete().eq("station_id", sid);
      if (!poolIsEmpty) {
        await supabase
          .from("station_card_pool")
          .insert(activeCardIds.map((cardId) => ({ station_id: sid, card_id: cardId, is_active: true })));
      }
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold">カード</h2>
      <p className="text-xs text-zinc-500">
        カード自体は全40種が共通マスタとして登録済み。駅ごとに「その駅で入手しうるカード」を絞り込める(未設定の駅は全カードが対象)。
        ミッション成功時、レアリティ加重抽選で1枚自動付与される。
      </p>

      <div className="mt-3 flex items-center gap-2 rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
        <span className="font-medium">ミッション成功時のカード自動付与</span>
        <button
          onClick={toggleAcquisition}
          disabled={busy}
          className={`rounded px-3 py-1 text-xs text-white ${cardAcquisitionEnabled ? "bg-emerald-600" : "bg-zinc-400"}`}
        >
          {cardAcquisitionEnabled ? "有効" : "無効"}(クリックで切替)
        </button>
      </div>

      <div className="mt-3 rounded border border-zinc-200 p-3 dark:border-zinc-800">
        <p className="text-sm font-medium">レアリティ出現比率</p>
        <div className="mt-1 flex flex-wrap gap-3">
          {(["NORMAL", "RARE", "SUPER_RARE"] as const).map((r) => (
            <div key={r} className="flex items-center gap-1 text-sm">
              <span className="text-xs text-zinc-500">{r}</span>
              <input
                type="number"
                value={weights[r] ?? 0}
                onChange={(e) => setWeights({ ...weights, [r]: Number(e.target.value) })}
                onBlur={() => saveWeight(r)}
                className="w-16 rounded border border-zinc-300 px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-800"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded border border-zinc-200 p-3 dark:border-zinc-800">
        <p className="mb-2 text-sm font-medium">駅ごとのカード出現プール設定</p>
        <StationMapPicker
          stations={stations}
          lines={lines}
          edges={edges}
          selectedStationId={stationId}
          onSelectStation={(sid, lineId) => {
            setStationId(sid);
            setSelectedLineId(lineId);
          }}
          customizedStationIds={customizedStationIds}
        />
      </div>

      <div className="mt-3 flex items-center justify-between">
        <p className="text-sm font-semibold">
          {stations.find((s) => s.id === stationId)?.name ?? "-"}
          {selectedLineId && (
            <span className="ml-1.5 font-normal text-zinc-400">({lineChains.find((l) => l.id === selectedLineId)?.name})</span>
          )}
        </p>
        <button
          type="button"
          disabled={busy || !stationId || !selectedLineId}
          onClick={applyToWholeLine}
          className="text-xs text-blue-600 hover:underline disabled:opacity-40 dark:text-blue-400"
          title={selectedLineId ? "" : "先に路線図上で駅をクリックして選択してください"}
        >
          この路線の全駅に同じ設定を適用
        </button>
      </div>
      {poolIsEmpty && <p className="mt-1 text-xs text-zinc-400">この駅は未設定(全カードが対象)。個別にチェックすると絞り込みになる。</p>}

      <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
        {cards.map((c) => (
          <label key={c.id} className="flex items-center gap-2 rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-800">
            <input
              type="checkbox"
              disabled={busy}
              checked={poolIsEmpty ? true : stationPoolCardIds.has(c.id)}
              onChange={(e) => toggleCard(c.id, e.target.checked)}
            />
            <span className={c.enabled ? "" : "text-zinc-400 line-through"}>
              [{c.rarity}] {c.name}
            </span>
            <button
              type="button"
              onClick={() => toggleCardEnabled(c)}
              className="ml-auto text-[10px] text-zinc-400 hover:underline"
              title="カード自体の全体的な有効/無効を切り替え"
            >
              {c.enabled ? "無効化" : "有効化"}
            </button>
          </label>
        ))}
      </div>
    </section>
  );
}
