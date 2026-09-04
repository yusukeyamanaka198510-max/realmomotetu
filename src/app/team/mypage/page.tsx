import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/game/actor";
import { createClient } from "@/lib/supabase/server";
import { GameBadge, GamePanel } from "@/components/game-ui";
import { CARD_RARITY_LABELS, type CardRarity } from "@/lib/game/types";
import { formatYen } from "@/lib/game/format";

export default async function MyPage() {
  const actor = await getActor();
  if (actor.kind !== "team") redirect("/login");

  const supabase = await createClient();

  const { data: cardsRaw } = await supabase
    .from("team_cards")
    .select("quantity, card:card_id(name, rarity)")
    .eq("team_id", actor.teamId)
    .gt("quantity", 0);
  const cards = (cardsRaw ?? [])
    .map((c) => {
      // @ts-expect-error 1:1リレーションが配列型で推論されるため
      const card = c.card as { name: string; rarity: CardRarity } | null;
      if (!card) return null;
      return { name: card.name, rarity: card.rarity, quantity: c.quantity };
    })
    .filter((c): c is { name: string; rarity: CardRarity; quantity: number } => !!c);

  const { data: propertiesRaw } = await supabase
    .from("team_property_purchases")
    .select("id, price_paid, yield_amount, settled, purchased_at, property:property_id(name, station:station_id(name))")
    .eq("team_id", actor.teamId)
    .order("purchased_at", { ascending: false });
  const properties = (propertiesRaw ?? []).map((p) => {
    // @ts-expect-error 1:1リレーションが配列型で推論されるため
    const property = p.property as { name: string; station: { name: string } | null } | null;
    return {
      id: p.id,
      name: property?.name ?? "-",
      stationName: property?.station?.name ?? "-",
      pricePaid: p.price_paid,
      yieldAmount: p.yield_amount,
      settled: p.settled,
    };
  });

  const activeProperties = properties.filter((p) => !p.settled);
  const propertyAssetTotal = activeProperties.reduce((sum, p) => sum + p.pricePaid, 0);

  return (
    <div className="mx-auto max-w-md space-y-4 p-6">
      <Link href="/team" className="text-sm text-zinc-500 hover:underline">
        ← TOPに戻る
      </Link>
      <h1 className="font-game text-xl font-black text-game-navy dark:text-game-gold">マイページ</h1>

      <GamePanel title={`所持カード(${cards.reduce((s, c) => s + c.quantity, 0)}枚)`} icon="🎴" accent="purple">
        {cards.length === 0 && <p className="text-xs text-zinc-400">まだ所持カードはありません</p>}
        <ul className="space-y-1.5 text-sm">
          {cards.map((c, i) => (
            <li key={i} className="flex items-center justify-between rounded-lg bg-zinc-50 px-2.5 py-1.5 dark:bg-zinc-800/60">
              <span>
                {c.name} <span className="text-xs text-zinc-400">x{c.quantity}</span>
              </span>
              <GameBadge tone={c.rarity === "SUPER_RARE" ? "purple" : c.rarity === "RARE" ? "blue" : "navy"}>
                {CARD_RARITY_LABELS[c.rarity]}
              </GameBadge>
            </li>
          ))}
        </ul>
      </GamePanel>

      <GamePanel title={`保有不動産(不動産資産額: ${formatYen(propertyAssetTotal)})`} icon="🏠" accent="green">
        {activeProperties.length === 0 && <p className="text-xs text-zinc-400">まだ保有不動産はありません</p>}
        <ul className="space-y-1.5 text-sm">
          {activeProperties.map((p) => (
            <li key={p.id} className="rounded-lg bg-zinc-50 px-2.5 py-1.5 dark:bg-zinc-800/60">
              <p className="font-bold">
                {p.name} <span className="text-xs font-normal text-zinc-400">({p.stationName})</span>
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                購入額: {formatYen(p.pricePaid)} / 利回り: +{formatYen(p.yieldAmount)}(決算のたび)
              </p>
            </li>
          ))}
        </ul>
      </GamePanel>
    </div>
  );
}
