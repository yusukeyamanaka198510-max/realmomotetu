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
  const { data: lines } = await supabase.from("lines").select("id, name").eq("event_id", actor.eventId).order("name");
  const { data: stations } = await supabase
    .from("stations")
    .select("id, name, is_destination_candidate")
    .eq("event_id", actor.eventId)
    .order("name");
  const { data: stationLines } = await supabase
    .from("station_lines")
    .select("station_id, line_id");
  const { data: edges } = await supabase
    .from("edges")
    .select("id, station_a_id, station_b_id, line_id")
    .eq("event_id", actor.eventId);
  const { data: missions } = await supabase
    .from("station_missions")
    .select("id, station_id, difficulty, title, description, success_reward, failure_penalty, is_active")
    .in("station_id", (stations ?? []).map((s) => s.id))
    .order("difficulty");
  const { data: properties } = await supabase
    .from("station_properties")
    .select("id, station_id, name, price, yield_amount, description, is_active")
    .in("station_id", (stations ?? []).map((s) => s.id));
  const { data: cardCatalog } = await supabase
    .from("cards")
    .select("id, card_code, name, category, rarity, enabled")
    .order("category")
    .order("rarity");
  const { data: cardPool } = await supabase
    .from("station_card_pool")
    .select("id, station_id, card_id, is_active")
    .in("station_id", (stations ?? []).map((s) => s.id));
  const { data: rarityWeights } = await supabase
    .from("card_rarity_weights")
    .select("rarity, weight")
    .eq("event_id", actor.eventId);
  const { data: eventCardSettings } = await supabase
    .from("events")
    .select("card_acquisition_enabled")
    .eq("id", actor.eventId)
    .single();

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
