"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  CARD_CATEGORY_LABELS,
  CARD_RARITY_LABELS,
  type CardCategory,
  type CardRarity,
  type CardTargetType,
  type TeamGameState,
} from "@/lib/game/types";
import { GameBadge, GameButton, GamePanel } from "@/components/game-ui";
import { formatYen } from "@/lib/game/format";
import { useDiceCard } from "./DiceCardContext";

export type OwnedCard = {
  card_id: string;
  quantity: number;
  card_code: string;
  name: string;
  category: CardCategory;
  rarity: CardRarity;
  description: string;
  effect_type: string;
  target_type: CardTargetType;
};

export type OtherTeam = { id: string; team_name: string; team_number: number };
export type TakeoverTarget = { purchase_id: string; team_id: string; team_name: string; property_name: string; price_paid: number };
export type ExchangeableCard = { card_code: string; name: string; rarity: CardRarity };
export type CardNotification = { id: string; message: string; created_at: string };
export type OwnProperty = { id: string; name: string; price: number };

const CATEGORY_ORDER: CardCategory[] = ["MOVEMENT", "OBSTRUCTION", "DEFENSE", "MISSION", "PROPERTY", "SPECIAL"];

// このカードは今のstateでないと使えない、という簡易ヒント(サーバー側の判定が最終的な正)
function isLikelyUsable(card: OwnedCard, state: TeamGameState): { ok: boolean; reason?: string } {
  switch (card.effect_type) {
    case "MOVEMENT_DICE":
    case "MOVEMENT_FIXED":
    case "MOVEMENT_UPTO":
    case "MOVEMENT_RANDOM_JUMP":
    case "MOVEMENT_DIRECT_TO_DEST":
    case "MOVEMENT_TELEPORT_TO_TEAM":
    case "MOVEMENT_TO_OWNED_PROPERTY":
    case "SWAP_LOCATION":
      if (state !== "DICE_READY") return { ok: false, reason: "サイコロを振れる状態ではありません" };
      return { ok: true };
    case "MISSION_REWARD_MULTIPLIER":
      if (!["MISSION_SELECTION", "MISSION_ACTIVE"].includes(state)) return { ok: false, reason: "ミッション中ではありません" };
      return { ok: true };
    case "MISSION_RESELECT_AFTER_FAILURE":
      if (state !== "MISSION_ACTIVE") return { ok: false, reason: "ミッション失敗直後のみ使用できます" };
      return { ok: true };
    case "MISSION_REROLL_OFFERED":
    case "GRANT_BONUS_MISSION":
      if (state !== "MISSION_SELECTION") return { ok: false, reason: "ミッション選択中のみ使用できます" };
      return { ok: true };
    case "PROPERTY_HALF_PRICE":
      if (state !== "PROPERTY_PURCHASE") return { ok: false, reason: "物件購入中のみ使用できます" };
      return { ok: true };
    default:
      return { ok: true };
  }
}

export function CardPanel({
  teamId,
  state,
  cards,
  otherTeams,
  takeoverTargets,
  exchangeableCards,
  notifications,
  ownProperties,
}: {
  teamId: string;
  state: TeamGameState;
  cards: OwnedCard[];
  otherTeams: OtherTeam[];
  takeoverTargets: TakeoverTarget[];
  exchangeableCards: ExchangeableCard[];
  notifications: CardNotification[];
  ownProperties: OwnProperty[];
}) {
  const router = useRouter();
  const { dicePhase, rollCardDice } = useDiceCard();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [pendingCard, setPendingCard] = useState<OwnedCard | null>(null);
  const [targetTeamId, setTargetTeamId] = useState("");
  const [payloadValue, setPayloadValue] = useState("");
  const [tab, setTab] = useState<CardCategory>("MOVEMENT");
  const [usingCard, setUsingCard] = useState<OwnedCard | null>(null);
  const [usePhase, setUsePhase] = useState<"activating" | "success" | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`team_cards:${teamId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_cards", filter: `team_id=eq.${teamId}` }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "card_notifications", filter: `team_id=eq.${teamId}` }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "card_active_effects", filter: `team_id=eq.${teamId}` }, () => router.refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [teamId, router]);

  const visibleNotifications = useMemo(() => notifications.filter((n) => !n.message.startsWith("🎴CARD:")), [notifications]);

  const grouped = useMemo(() => {
    const map = new Map<CardCategory, OwnedCard[]>();
    for (const c of cards) {
      const list = map.get(c.category) ?? [];
      list.push(c);
      map.set(c.category, list);
    }
    return map;
  }, [cards]);

  function needsPayload(card: OwnedCard): "property" | "voucher" | "takeover" | null {
    if (card.effect_type === "PROPERTY_HALF_PRICE") return "property";
    if (card.effect_type === "VOUCHER_EXCHANGE") return "voucher";
    if (card.effect_type === "PROPERTY_TAKEOVER") return "takeover";
    return null;
  }

  async function executeUse(card: OwnedCard, target: string | null, payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setLastMessage(null);
    setUsingCard(card);
    setUsePhase("activating");
    const supabase = createClient();
    const idempotencyKey = crypto.randomUUID();
    const { data, error } = await supabase.rpc("fn_use_card", {
      p_idempotency_key: idempotencyKey,
      p_card_code: card.card_code,
      p_target_team_id: target,
      p_payload: payload,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      setUsingCard(null);
      setUsePhase(null);
      return;
    }
    const result = data as { message?: string; result?: string } | null;
    setLastMessage(result?.message ?? `${card.name}を使用しました。`);
    setPendingCard(null);
    setTargetTeamId("");
    setPayloadValue("");
    setUsePhase("success");
    setTimeout(() => {
      setUsingCard(null);
      setUsePhase(null);
    }, 1400);
    router.refresh();
  }

  async function handleUseMovementDiceCard(card: OwnedCard) {
    if (!window.confirm(`${card.name}を使用しますか?`)) return;
    setBusy(true);
    setError(null);
    setLastMessage(null);
    const { error, message } = await rollCardDice(card.card_code);
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    setLastMessage(message ?? `${card.name}を使用しました。`);
  }

  function handleUseClick(card: OwnedCard) {
    setError(null);
    setLastMessage(null);
    if (card.effect_type === "MOVEMENT_DICE") {
      void handleUseMovementDiceCard(card);
      return;
    }
    if (card.target_type === "OTHER_TEAM" || needsPayload(card)) {
      setPendingCard(card);
      setTargetTeamId("");
      setPayloadValue("");
      return;
    }
    if (!window.confirm(`${card.name}を使用しますか?`)) return;
    void executeUse(card, null, {});
  }

  function handleConfirmPending() {
    if (!pendingCard) return;
    const payloadKind = needsPayload(pendingCard);
    if (pendingCard.target_type === "OTHER_TEAM" && !targetTeamId && payloadKind !== "takeover") {
      setError("対象チームを選択してください");
      return;
    }
    let payload: Record<string, unknown> = {};
    let target: string | null = targetTeamId || null;
    if (payloadKind === "property") {
      if (!payloadValue) return setError("対象の物件を選択してください");
      payload = { property_id: payloadValue };
    } else if (payloadKind === "voucher") {
      if (!payloadValue) return setError("交換したいカードを選択してください");
      payload = { target_card_code: payloadValue };
    } else if (payloadKind === "takeover") {
      if (!payloadValue) return setError("対象の物件を選択してください");
      const t = takeoverTargets.find((x) => x.purchase_id === payloadValue);
      if (!t) return setError("対象が見つかりません");
      payload = { purchase_id: payloadValue };
      target = t.team_id;
    }
    void executeUse(pendingCard, target, payload);
  }

  const rarityGlow: Record<CardRarity, string> = {
    NORMAL: "shadow-zinc-400/60 border-zinc-400",
    RARE: "shadow-blue-500/60 border-blue-500",
    SUPER_RARE: "shadow-purple-500/60 border-purple-500",
  };

  return (
    <GamePanel title={`所持カード(${cards.reduce((s, c) => s + c.quantity, 0)}枚)`} icon="🎴" accent="purple" className="mt-6">
      {usingCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="status">
          <div
            className={`w-64 rounded-[var(--game-radius-lg)] border-4 bg-white p-5 text-center shadow-[var(--game-shadow-lg)] dark:bg-zinc-900 ${rarityGlow[usingCard.rarity]} ${
              usePhase === "activating" ? "animate-[card-charge_0.9s_ease-in-out_infinite]" : "anim-pop"
            }`}
          >
            <p className="text-xs font-bold uppercase tracking-wide text-game-purple">
              {usePhase === "activating" ? "発動中..." : "発動!"}
            </p>
            <p className="mt-3 text-lg font-bold text-zinc-900 dark:text-zinc-50">{usingCard.name}</p>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{CARD_RARITY_LABELS[usingCard.rarity]}</p>
          </div>
          <style>{`
            @keyframes card-charge {
              0%, 100% { transform: scale(1); filter: brightness(1); }
              50% { transform: scale(1.05); filter: brightness(1.15); }
            }
          `}</style>
        </div>
      )}

      {visibleNotifications.length > 0 && (
        <div className="mb-2 space-y-1.5">
          {visibleNotifications.slice(0, 3).map((n) =>
            n.message.startsWith("🏁") ? (
              <p
                key={n.id}
                className="anim-pop rounded-xl border-2 border-game-gold bg-amber-100 p-2.5 text-xs font-bold text-amber-900 shadow-[var(--game-shadow-sm)] dark:bg-amber-900 dark:text-amber-100"
              >
                {n.message}
              </p>
            ) : (
              <p key={n.id} className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                ⚠ {n.message}
              </p>
            )
          )}
        </div>
      )}
      {lastMessage && <p className="mb-2 text-xs font-bold text-game-green">{lastMessage}</p>}
      {error && <p className="mb-2 text-xs font-bold text-game-red">{error}</p>}

      <div className="flex flex-wrap gap-1">
        {CATEGORY_ORDER.filter((c) => (grouped.get(c) ?? []).length > 0).map((c) => (
          <button
            key={c}
            onClick={() => setTab(c)}
            className={`rounded-full px-2.5 py-1 text-xs font-bold transition-colors ${
              tab === c ? "bg-game-purple text-white" : "border-2 border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
            }`}
          >
            {CARD_CATEGORY_LABELS[c]}({(grouped.get(c) ?? []).reduce((s, x) => s + x.quantity, 0)})
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        {(grouped.get(tab) ?? []).length === 0 && <p className="text-xs text-zinc-400">このカテゴリのカードはありません</p>}
        {(grouped.get(tab) ?? []).map((c) => {
          const usable = isLikelyUsable(c, state);
          if (usable.ok && c.effect_type === "MOVEMENT_DICE" && dicePhase !== null) {
            usable.ok = false;
            usable.reason = "サイコロの演出中です";
          }
          return (
            <div
              key={c.card_id}
              className={`rounded-xl border-2 border-l-4 bg-white p-2.5 dark:bg-zinc-900 ${
                c.rarity === "SUPER_RARE" ? "border-purple-300 border-l-game-purple" : c.rarity === "RARE" ? "border-blue-200 border-l-game-blue" : "border-zinc-200 border-l-zinc-400 dark:border-zinc-800"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold">
                  {c.name} <span className="text-xs font-normal text-zinc-400">x{c.quantity}</span>
                </span>
                <GameBadge tone={c.rarity === "SUPER_RARE" ? "purple" : c.rarity === "RARE" ? "blue" : "navy"}>
                  {CARD_RARITY_LABELS[c.rarity]}
                </GameBadge>
              </div>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{c.description}</p>
              {c.effect_type === "BARRIER" ? (
                <p className="mt-1 text-xs text-zinc-400">所持しているだけで妨害を自動無効化します(使用操作不要)</p>
              ) : (
                <GameButton disabled={busy || !usable.ok || c.quantity < 1} onClick={() => handleUseClick(c)} variant="card" className="mt-1.5 !px-3 !py-1.5 !text-xs">
                  使用する
                </GameButton>
              )}
              {!usable.ok && <span className="ml-2 text-xs text-zinc-400">({usable.reason})</span>}
            </div>
          );
        })}
      </div>

      {pendingCard && (
        <div className="mt-3 rounded-xl border-2 border-zinc-300 p-3 dark:border-zinc-700">
          <p className="text-sm font-bold">{pendingCard.name}を使用</p>
          {pendingCard.target_type === "OTHER_TEAM" && needsPayload(pendingCard) !== "takeover" && (
            <select
              value={targetTeamId}
              onChange={(e) => setTargetTeamId(e.target.value)}
              className="mt-2 w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="">対象チームを選択</option>
              {otherTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  TEAM {t.team_number} {t.team_name}
                </option>
              ))}
            </select>
          )}
          {needsPayload(pendingCard) === "property" && (
            <select
              value={payloadValue}
              onChange={(e) => setPayloadValue(e.target.value)}
              className="mt-2 w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="">対象の物件を選択(現在駅の物件のみ)</option>
              {ownProperties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}(半額: {formatYen(Math.floor(p.price / 2))})
                </option>
              ))}
            </select>
          )}
          {needsPayload(pendingCard) === "voucher" && (
            <select
              value={payloadValue}
              onChange={(e) => setPayloadValue(e.target.value)}
              className="mt-2 w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="">交換したいカードを選択</option>
              {exchangeableCards.map((c) => (
                <option key={c.card_code} value={c.card_code}>
                  {c.name}({CARD_RARITY_LABELS[c.rarity]})
                </option>
              ))}
            </select>
          )}
          {needsPayload(pendingCard) === "takeover" && (
            <select
              value={payloadValue}
              onChange={(e) => setPayloadValue(e.target.value)}
              className="mt-2 w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="">乗っ取る物件を選択</option>
              {takeoverTargets.map((t) => (
                <option key={t.purchase_id} value={t.purchase_id}>
                  {t.team_name} / {t.property_name}(価格: {formatYen(t.price_paid)})
                </option>
              ))}
            </select>
          )}
          <div className="mt-2 flex gap-2">
            <GameButton disabled={busy} onClick={handleConfirmPending} variant="card" className="!px-3 !py-1.5 !text-xs">
              確定して使用
            </GameButton>
            <GameButton
              disabled={busy}
              onClick={() => {
                setPendingCard(null);
                setError(null);
              }}
              variant="secondary"
              className="!px-3 !py-1.5 !text-xs"
            >
              キャンセル
            </GameButton>
          </div>
        </div>
      )}
    </GamePanel>
  );
}
