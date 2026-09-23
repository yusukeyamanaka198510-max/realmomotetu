import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/game/actor";
import { createClient } from "@/lib/supabase/server";
import { LinesManager } from "./LinesManager";
import { StationsManager } from "./StationsManager";
import { EdgesManager } from "./EdgesManager";
import { MissionsManager } from "./MissionsManager";
import { PropertiesManager } from "./PropertiesManager";
import { CardsManager } from "./CardsManager";

export default async function ManagePage() {
  const actor = await getActor();
  if (actor.kind !== "staff") redirect("/login");

  const supabase = await createClient();

  // 駅一覧(stations)は後続クエリの絞り込みに使うため先に取得する必要があるが、それ以外は
  // 互いに依存しないので並列化する(順番に9回await していたため、遷移のたびに待たされていた)。
  const [{ data: lines }, { data: stations }, { data: stationLines }, { data: edges }, { data: cardCatalog }, { data: rarityWeights }, { data: eventCardSettings }] =
    await Promise.all([
      supabase.from("lines").select("id, name").eq("event_id", actor.eventId).order("name"),
      supabase.from("stations").select("id, name, is_destination_candidate").eq("event_id", actor.eventId).order("name"),
      supabase.from("station_lines").select("station_id, line_id"),
      supabase.from("edges").select("id, station_a_id, station_b_id, line_id").eq("event_id", actor.eventId),
      supabase.from("cards").select("id, card_code, name, category, rarity, enabled").order("category").order("rarity"),
      supabase.from("card_rarity_weights").select("rarity, weight").eq("event_id", actor.eventId),
      supabase.from("events").select("card_acquisition_enabled").eq("id", actor.eventId).single(),
    ]);

  const stationIds = (stations ?? []).map((s) => s.id);
  const [{ data: missions }, { data: properties }, { data: cardPool }] = await Promise.all([
    supabase
      .from("station_missions")
      .select("id, station_id, difficulty, title, description, success_reward, failure_penalty, is_active")
      .in("station_id", stationIds)
      .order("difficulty"),
    supabase
      .from("station_properties")
      .select("id, station_id, name, price, yield_amount, description, is_active")
      .in("station_id", stationIds),
    supabase.from("station_card_pool").select("id, station_id, card_id, is_active").in("station_id", stationIds),
  ]);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <Link href="/staff" className="text-sm text-zinc-500 hover:underline">
        ← ダッシュボードに戻る
      </Link>
      <h1 className="mt-2 text-xl font-semibold">駅・路線・ミッション管理</h1>

      <LinesManager lines={lines ?? []} />
      <StationsManager stations={stations ?? []} lines={lines ?? []} stationLines={stationLines ?? []} />
      <EdgesManager stations={stations ?? []} lines={lines ?? []} edges={edges ?? []} eventId={actor.eventId} />
      <MissionsManager stations={stations ?? []} missions={missions ?? []} />
      <PropertiesManager stations={stations ?? []} properties={properties ?? []} />
      <CardsManager
        stations={stations ?? []}
        lines={lines ?? []}
        edges={edges ?? []}
        cards={cardCatalog ?? []}
        pool={cardPool ?? []}
        rarityWeights={rarityWeights ?? []}
        cardAcquisitionEnabled={eventCardSettings?.card_acquisition_enabled ?? true}
      />
    </div>
  );
}
