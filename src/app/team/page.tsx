import { redirect } from "next/navigation";
import Link from "next/link";
import { getActor } from "@/lib/game/actor";
import { createClient } from "@/lib/supabase/server";
import { TeamGameFlow } from "./TeamGameFlow";
import { DiceCardProvider } from "./DiceCardContext";
import { Leaderboard } from "./Leaderboard";
import { CardPanel, type OwnedCard } from "./CardPanel";
import { BonusMissionPanel } from "./BonusMissionPanel";
import { MISSION_DEFAULT_REWARD, type MissionDifficulty, type TeamGameState } from "@/lib/game/types";
import { CountdownTimer } from "@/components/CountdownTimer";
import { StatusHeader } from "./StatusHeader";
import { CardSlotOverlay } from "./CardSlotOverlay";
import { DestinationArrivalOverlay } from "./DestinationArrivalOverlay";
import { GoalBroadcastOverlay } from "./GoalBroadcastOverlay";
import { DividendAnnouncementOverlay } from "./DividendAnnouncementOverlay";
import { BombiiCurseOverlay } from "./BombiiCurseOverlay";
import { LuckyChanceOverlay } from "./LuckyChanceOverlay";
import { EventStartOverlay } from "./EventStartOverlay";
import { AnnouncementBox } from "./AnnouncementBox";
import { GameStartIntro } from "./GameStartIntro";
import { ScheduledStartCountdown } from "./ScheduledStartCountdown";
import { StartStationPicker } from "./StartStationPicker";

export default async function TeamPage() {
  const actor = await getActor();
  if (actor.kind !== "team") redirect("/login");

  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select(
      "id, status, end_at, active_destination_station_id, active_destination:active_destination_station_id(name), scheduled_start_at"
    )
    .eq("id", actor.eventId)
    .single();

  if (event?.status === "SCHEDULED") {
    const { data: stations } = await supabase.from("stations").select("id, name").eq("event_id", actor.eventId);
    const { data: scheduledState } = await supabase
      .from("team_state")
      .select("selected_start_station_id")
      .eq("team_id", actor.teamId)
      .single();

    return (
      <div className="min-h-dvh bg-cover bg-top bg-fixed" style={{ backgroundImage: "url(/board-illustration.webp)" }}>
        <div className="flex min-h-dvh flex-col bg-white/55 dark:bg-slate-950/70">
          <div className="mx-auto w-full max-w-md p-6">
            <div className="flex items-center justify-between">
              <h1 className="font-game text-lg font-black text-game-navy dark:text-game-gold">🚃 {actor.teamName}</h1>
              <Link
                href="/team/mypage"
                className="shrink-0 rounded-full border-2 border-zinc-300 bg-white px-2.5 py-1 text-xs font-bold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              >
                マイページ
              </Link>
            </div>
          </div>
          <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 p-6">
            <div className="anim-pop w-full rounded-[var(--game-radius-lg)] border-4 border-game-gold bg-gradient-to-b from-game-navy to-slate-900 p-8 text-center shadow-[var(--game-shadow-lg)]">
              <p className="text-5xl">⏳</p>
              <p className="game-text-event mt-3 text-2xl text-white">イベント開始前です</p>
              <ScheduledStartCountdown scheduledStartAt={event.scheduled_start_at} />
            </div>
            <StartStationPicker
              stations={stations ?? []}
              initialSelectedStationId={scheduledState?.selected_start_station_id ?? null}
            />
          </div>
        </div>
      </div>
    );
  }

  // @ts-expect-error 1:1リレーションが配列型で推論されるため
  const destinationStationName: string | null = event?.active_destination?.name ?? null;
  const { data: state } = await supabase
    .from("team_state")
    .select(
      "state, coin_balance_cache, mission_success_count, current_turn_id, current_station_id, current_station:current_station_id(name), has_bombii"
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

  let goalDistanceByStationId: Record<string, number> = {};
  if (event?.active_destination_station_id) {
    const { data: distances } = await supabase.rpc("fn_station_distances_from", {
      p_from: event.active_destination_station_id,
    });
    goalDistanceByStationId = Object.fromEntries(
      (distances ?? []).map((d: { station_id: string; hops: number }) => [d.station_id, d.hops])
    );
  }
  const currentGoalDistance: number | null =
    state?.current_station_id && goalDistanceByStationId[state.current_station_id] !== undefined
      ? goalDistanceByStationId[state.current_station_id]
      : null;

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

  const { data: myPropertyPurchases } = await supabase
    .from("team_property_purchases")
    .select("price_paid")
    .eq("team_id", actor.teamId)
    .eq("settled", false);
  const propertyAssetTotal = (myPropertyPurchases ?? []).reduce((sum, p) => sum + p.price_paid, 0);

  const { data: myCardsRaw } = await supabase
    .from("team_cards")
    .select("card_id, quantity, card:card_id(card_code, name, category, rarity, description, effect_type, effect_value, target_type)")
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

  const { data: otherTeamsStatusRaw } = await supabase.rpc("fn_get_other_teams_status");
  const otherTeamsRaw = (
    (otherTeamsStatusRaw ?? []) as {
      team_id: string;
      team_number: number;
      team_name: string;
      coin_balance_cache: number;
      station_name: string | null;
    }[]
  ).map((t) => ({
    id: t.team_id,
    team_name: t.team_name,
    team_number: t.team_number,
    coin_balance_cache: t.coin_balance_cache,
    station_name: t.station_name,
  }));

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
    .select("id, effect_type, payload")
    .eq("team_id", actor.teamId)
    .is("consumed_at", null);

  // 絶好調カード等、「通常サイコロ1個のリクエストをサーバー側で複数個に引き上げる」効果が
  // 有効な間は、演出開始時点でその個数を知っておかないと(振っている最中は1個表示のまま、
  // 着地の瞬間だけ複数個に変わって見える不具合になるため)クライアント側にも渡しておく。
  const hotStreakEffect = (activeEffects ?? []).find((e) => e.effect_type === "HOT_STREAK");
  const hotStreakDiceCount = hotStreakEffect
    ? Number((hotStreakEffect.payload as { dice_count?: number } | null)?.dice_count ?? 2)
    : null;


  // eslint-disable-next-line react-hooks/purity -- Server Componentがリクエスト時点のサーバー時刻で判定するのは意図通り
  const nowMs = Date.now();
  const isEventScheduled = event?.status === "SCHEDULED";
  const isEventOver =
    !!event &&
    !isEventScheduled &&
    (event.status === "FORCE_ENDED" || event.status === "ENDED" || (!!event.end_at && new Date(event.end_at).getTime() <= nowMs));

  const inTransitStates: TeamGameState[] = ["TRAVELING", "ARRIVAL_SUBMISSION", "ARRIVAL_REVIEW"];
  const isInTransit = state?.state && inTransitStates.includes(state.state as TeamGameState) && !!nextStationName;
  const transitLabel = state?.state === "TRAVELING" ? "移動中" : state?.state === "ARRIVAL_REVIEW" ? "本部確認中" : "到着報告中";

  return (
    <div
      className="min-h-dvh bg-cover bg-top bg-fixed"
      style={{ backgroundImage: "url(/board-illustration.webp)" }}
    >
      <div className="min-h-dvh bg-white/55 dark:bg-slate-950/70">
        <div className="mx-auto max-w-md p-6">
          <GameStartIntro isRunning={!!event && event.status === "RUNNING" && !isEventOver} />
      <StatusHeader
        teamName={actor.teamName}
        representativeName={actor.representativeName}
        state={(state?.state ?? "WAITING") as TeamGameState}
        isEventOver={isEventOver}
        isEventScheduled={isEventScheduled}
        coinBalance={state?.coin_balance_cache ?? 0}
        currentStationName={currentStationName}
        transitLabel={isInTransit ? transitLabel : null}
        nextStationName={isInTransit ? nextStationName : null}
        destinationStationName={destinationStationName}
        currentGoalDistance={currentGoalDistance}
        propertyAssetTotal={propertyAssetTotal}
        activeEffects={activeEffects ?? []}
        hasBombii={state?.has_bombii ?? false}
      />
      <AnnouncementBox notifications={notifications ?? []} />
      {event && <CountdownTimer eventId={event.id} endAt={event.end_at} status={event.status} />}

      <CardSlotOverlay notifications={notifications ?? []} />
      <DestinationArrivalOverlay notifications={notifications ?? []} />
      <GoalBroadcastOverlay notifications={notifications ?? []} />
      <DividendAnnouncementOverlay notifications={notifications ?? []} />
      <BombiiCurseOverlay notifications={notifications ?? []} myTeamName={actor.teamName} />
      <LuckyChanceOverlay notifications={notifications ?? []} />
      <EventStartOverlay notifications={notifications ?? []} />

      <DiceCardProvider
        initialState={(state?.state ?? "WAITING") as TeamGameState}
        diceResult={diceResult}
        hotStreakDiceCount={hotStreakDiceCount}
      >
        <TeamGameFlow
          teamId={actor.teamId}
          eventId={actor.eventId}
          initialState={state?.state ?? "WAITING"}
          nextStationName={nextStationName}
          startStationName={currentStationName}
          missionAttempt={missionAttempt}
          offeredMissions={offeredMissions}
          diceResult={diceResult}
          reachableStations={reachableStations}
          goalDistanceByStationId={goalDistanceByStationId}
          coinBalance={state?.coin_balance_cache ?? 0}
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
          ownProperties={properties}
        />
      </DiceCardProvider>

      <div id="leaderboard">
        <Leaderboard eventId={actor.eventId} />
      </div>

        </div>
      </div>
    </div>
  );
}
