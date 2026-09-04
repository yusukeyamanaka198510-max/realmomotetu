import { redirect } from "next/navigation";
import { getActor } from "@/lib/game/actor";
import { createClient } from "@/lib/supabase/server";
import { TeamGameFlow } from "./TeamGameFlow";
import { Leaderboard } from "./Leaderboard";
import { CardPanel, type OwnedCard } from "./CardPanel";
import { BonusMissionPanel } from "./BonusMissionPanel";
import { MISSION_DEFAULT_REWARD, type MissionDifficulty, type TeamGameState } from "@/lib/game/types";
import { PasswordChangePanel } from "@/components/PasswordChangePanel";
import { CountdownTimer } from "@/components/CountdownTimer";
import { StatusHeader } from "./StatusHeader";
import { CardSlotOverlay } from "./CardSlotOverlay";
import { DestinationArrivalOverlay } from "./DestinationArrivalOverlay";
import { GameStartIntro } from "./GameStartIntro";
import { ActionHistory } from "./ActionHistory";
import { TeamPositionMap, type LineTopology } from "./TeamPositionMap";

export default async function TeamPage() {
  const actor = await getActor();
  if (actor.kind !== "team") redirect("/login");

  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select("id, status, end_at, active_destination_station_id, active_destination:active_destination_station_id(name)")
    .eq("id", actor.eventId)
    .single();
  // @ts-expect-error 1:1リレーションが配列型で推論されるため
  const destinationStationName: string | null = event?.active_destination?.name ?? null;
  const { data: state } = await supabase
    .from("team_state")
    .select(
      "state, coin_balance_cache, mission_success_count, current_turn_id, current_station_id, current_station:current_station_id(name)"
    )
    .eq("team_id", actor.teamId)
    .single();

  let nextStationName: string | null = null;
  if (state?.current_turn_id) {
    const { data: turn } = await supabase
      .from("turns")
      .select("next_station:next_station_id(name)")
      .eq("id", state.current_turn_id)
      .maybeSingle();
    // @ts-expect-error 1:1リレーションが配列型で推論されるため
    nextStationName = turn?.next_station?.name ?? null;
  }

  // @ts-expect-error 1:1リレーションが配列型で推論されるため
  const currentStationName: string | null = state?.current_station?.name ?? null;

  let diceResult: { total: number; individual_results: number[] } | null = null;
  let reachableStations: { id: string; name: string }[] = [];

  if (state?.current_turn_id && state.state === "DESTINATION_SELECTION") {
    const { data: diceRoll } = await supabase
      .from("dice_rolls")
      .select("id, total, individual_results")
      .eq("turn_id", state.current_turn_id)
      .eq("is_valid", true)
      .order("rolled_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (diceRoll) {
      diceResult = { total: diceRoll.total, individual_results: diceRoll.individual_results as number[] };
      const { data: snapshot } = await supabase
        .from("reachable_stations_snapshot")
        .select("station:station_id(id, name)")
        .eq("dice_roll_id", diceRoll.id);
      reachableStations = (snapshot ?? [])
        .map((s) => s.station as unknown as { id: string; name: string } | null)
        .filter((s): s is { id: string; name: string } => !!s);
    }
  }

  let missionAttempt: {
    id: string;
    offered_mission_ids: string[];
    selected_mission_id: string | null;
    status: string;
  } | null = null;
  let offeredMissions: {
    id: string;
    title: string;
    description: string;
    difficulty: MissionDifficulty;
    reward: number;
  }[] = [];

  if (state?.current_turn_id && ["MISSION_SELECTION", "MISSION_ACTIVE", "MISSION_REVIEW"].includes(state.state)) {
    const { data: attempt } = await supabase
      .from("team_mission_attempts")
      .select("id, offered_mission_ids, selected_mission_id, status")
      .eq("team_id", actor.teamId)
      .eq("turn_id", state.current_turn_id)
      .order("attempt_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    missionAttempt = attempt;

    if (attempt?.offered_mission_ids?.length) {
      const { data: missions } = await supabase
        .from("station_missions")
        .select("id, title, description, difficulty, success_reward")
        .in("id", attempt.offered_mission_ids);
      offeredMissions = (attempt.offered_mission_ids as string[])
        .map((id: string) => {
          const m = missions?.find((x) => x.id === id);
          if (!m) return null;
          const difficulty = m.difficulty as MissionDifficulty;
          return {
            id: m.id,
            title: m.title,
            description: m.description,
            difficulty,
            reward: m.success_reward ?? MISSION_DEFAULT_REWARD[difficulty],
          };
        })
        .filter((m): m is NonNullable<typeof m> => !!m);
    }
  }

  let bonusMissionAttempt: { id: string; title: string | null; description: string | null; reward: number; status: string } | null = null;
  if (state?.current_turn_id) {
    const { data: bonusAttempt } = await supabase
      .from("team_bonus_mission_attempts")
      .select("id, title, description, reward, status")
      .eq("team_id", actor.teamId)
      .eq("turn_id", state.current_turn_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    bonusMissionAttempt = bonusAttempt;
  }

  let properties: { id: string; name: string; price: number; yield_amount: number; description: string }[] = [];
  if (state?.state === "PROPERTY_PURCHASE" && state.current_station_id) {
    const { data } = await supabase
      .from("station_properties")
      .select("id, name, price, yield_amount, description")
      .eq("station_id", state.current_station_id)
      .eq("is_active", true);
    properties = data ?? [];
  }

  const { data: myCardsRaw } = await supabase
    .from("team_cards")
    .select("card_id, quantity, card:card_id(card_code, name, category, rarity, description, effect_type, target_type)")
    .eq("team_id", actor.teamId)
    .gt("quantity", 0);
  const myCards: OwnedCard[] = (myCardsRaw ?? [])
    .map((row) => {
      // @ts-expect-error 1:1リレーションが配列型で推論されるため
      const card = row.card as Omit<OwnedCard, "card_id" | "quantity"> | null;
      if (!card) return null;
      return { card_id: row.card_id, quantity: row.quantity, ...card };
    })
    .filter((c): c is OwnedCard => !!c);

  const { data: otherTeamsRaw } = await supabase
    .from("teams")
    .select("id, team_name, team_number")
    .eq("event_id", actor.eventId)
    .neq("id", actor.teamId)
    .order("team_number");

  const { data: exchangeableCardsRaw } = await supabase
    .from("cards")
    .select("card_code, name, rarity")
    .eq("enabled", true)
    .eq("exchangeable", true)
    .neq("card_code", "VOUCHER");

  const { data: takeoverTargetsRaw } = await supabase
    .from("team_property_purchases")
    .select("id, team_id, price_paid, property:property_id(name), team:team_id(team_name)")
    .neq("team_id", actor.teamId)
    .eq("settled", false);
  const takeoverTargets = (takeoverTargetsRaw ?? []).map((t) => ({
    purchase_id: t.id,
    team_id: t.team_id,
    // @ts-expect-error 1:1リレーションが配列型で推論されるため
    team_name: t.team?.team_name ?? "",
    // @ts-expect-error 1:1リレーションが配列型で推論されるため
    property_name: t.property?.name ?? "",
    price_paid: t.price_paid,
  }));

  const { data: notifications } = await supabase
    .from("card_notifications")
    .select("id, message, created_at")
    .eq("team_id", actor.teamId)
    .order("created_at", { ascending: false })
    .limit(10);

  const { data: activeEffects } = await supabase
    .from("card_active_effects")
    .select("id, effect_type")
    .eq("team_id", actor.teamId)
    .is("consumed_at", null);

  const { data: linesRaw } = await supabase.from("lines").select("id, name").eq("event_id", actor.eventId);
  const { data: edgesRaw } = await supabase.from("edges").select("line_id, station_a_id, station_b_id").eq("event_id", actor.eventId);
  const { data: allStationsRaw } = await supabase.from("stations").select("id, name").eq("event_id", actor.eventId);
  const stationNames: Record<string, string> = Object.fromEntries((allStationsRaw ?? []).map((s) => [s.id, s.name]));
  const lineTopologies: LineTopology[] = (linesRaw ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    edges: (edgesRaw ?? [])
      .filter((e) => e.line_id === l.id)
      .map((e) => ({ a: e.station_a_id as string, b: e.station_b_id as string })),
  }));

  // eslint-disable-next-line react-hooks/purity -- Server Componentがリクエスト時点のサーバー時刻で判定するのは意図通り
  const nowMs = Date.now();
  const isEventOver =
    !!event &&
    (event.status === "FORCE_ENDED" || event.status === "ENDED" || (!!event.end_at && new Date(event.end_at).getTime() <= nowMs));
  const isEventScheduled = event?.status === "SCHEDULED";

  const inTransitStates: TeamGameState[] = ["TRAVELING", "ARRIVAL_SUBMISSION", "ARRIVAL_REVIEW"];
  const isInTransit = state?.state && inTransitStates.includes(state.state as TeamGameState) && !!nextStationName;
  const transitLabel = state?.state === "TRAVELING" ? "移動中" : state?.state === "ARRIVAL_REVIEW" ? "本部確認中" : "到着報告中";

  return (
    <div className="mx-auto max-w-md p-6">
      <GameStartIntro isRunning={!!event && event.status === "RUNNING" && !isEventOver} />
      <StatusHeader
        teamName={actor.teamName}
        state={(state?.state ?? "WAITING") as TeamGameState}
        isEventOver={isEventOver}
        isEventScheduled={isEventScheduled}
        coinBalance={state?.coin_balance_cache ?? 0}
        currentStationName={currentStationName}
        transitLabel={isInTransit ? transitLabel : null}
        nextStationName={isInTransit ? nextStationName : null}
        destinationStationName={destinationStationName}
        activeEffects={activeEffects ?? []}
      />
      {event && <CountdownTimer eventId={event.id} endAt={event.end_at} status={event.status} />}
      <PasswordChangePanel />

      <CardSlotOverlay notifications={notifications ?? []} />
      <DestinationArrivalOverlay notifications={notifications ?? []} />

      <TeamGameFlow
        teamId={actor.teamId}
        eventId={actor.eventId}
        initialState={state?.state ?? "WAITING"}
        nextStationName={nextStationName}
        missionAttempt={missionAttempt}
        offeredMissions={offeredMissions}
        diceResult={diceResult}
        reachableStations={reachableStations}
        properties={properties}
        isEventOver={isEventOver}
        isEventScheduled={isEventScheduled}
      />

      {!isEventOver && <BonusMissionPanel teamId={actor.teamId} eventId={actor.eventId} attempt={bonusMissionAttempt} />}

      <CardPanel
        teamId={actor.teamId}
        state={(state?.state ?? "WAITING") as TeamGameState}
        cards={myCards}
        otherTeams={otherTeamsRaw ?? []}
        takeoverTargets={takeoverTargets}
        exchangeableCards={exchangeableCardsRaw ?? []}
        notifications={notifications ?? []}
        ownProperties={properties}
      />

      <Leaderboard eventId={actor.eventId} />

      <TeamPositionMap lines={lineTopologies} stationNames={stationNames} />

      <ActionHistory teamId={actor.teamId} />
    </div>
  );
}
