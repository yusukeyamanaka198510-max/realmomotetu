/**
 * カード機能の検証スクリプト。
 * 実行: npx tsx scripts/test-cards.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

async function login(email: string) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "momotetsu-dev-2026" }),
  });
  return (await res.json()).access_token as string;
}

async function rpc(fn: string, token: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  return { status: res.status, body: json };
}

async function main() {
  const { data: event } = await admin.from("events").select("id").single();
  const eventId = event!.id as string;
  const staffToken = await login("staff1@momotetsu.test");
  await admin.from("events").update({ status: "RUNNING", end_at: new Date(Date.now() + 3600_000).toISOString() }).eq("id", eventId);
  const { data: team1 } = await admin.from("teams").select("id").eq("team_number", 1).single();
  const { data: team2 } = await admin.from("teams").select("id").eq("team_number", 2).single();
  const team1Token = await login("team01@momotetsu.test");
  const { data: tokyo } = await admin.from("stations").select("id").eq("event_id", eventId).eq("name", "東京").single();

  // クリーンアップしてDICE_READY状態から開始
  for (const teamId of [team1!.id, team2!.id]) {
    await admin.from("team_state").update({
      state: "DICE_READY", current_station_id: tokyo!.id, current_turn_id: null,
      coin_balance_cache: 100_000_000, is_paused: false,
    }).eq("team_id", teamId);
    await admin.from("team_cards").delete().eq("team_id", teamId);
    await admin.from("card_active_effects").delete().eq("team_id", teamId);
    await admin.from("card_usage_log").delete().eq("team_id", teamId);
    await admin.from("turns").delete().eq("team_id", teamId);
  }

  async function grant(teamId: string, code: string, qty = 1) {
    await rpc("fn_admin_grant_card", staffToken, { p_team_id: teamId, p_card_code: code, p_qty: qty });
  }

  console.log("=== 1. カードマスタ件数確認 ===");
  const { count } = await admin.from("cards").select("*", { count: "exact", head: true });
  console.log("カード総数:", count, count === 40 ? "OK" : "NG(40件のはず)");

  console.log("\n=== 2. 移動カード(1進めるカード) ===");
  await grant(team1!.id, "ADVANCE_1");
  const idem1 = crypto.randomUUID();
  const use1 = await rpc("fn_use_card", team1Token, { p_idempotency_key: idem1, p_card_code: "ADVANCE_1" });
  console.log("fn_use_card(ADVANCE_1):", use1.status, JSON.stringify(use1.body));
  const stateAfter1 = await admin.from("team_state").select("state").eq("team_id", team1!.id).single();
  console.log("state == DESTINATION_SELECTION か:", stateAfter1.data!.state === "DESTINATION_SELECTION" ? "OK" : `NG(${stateAfter1.data!.state})`);

  console.log("\n=== 3. 冪等性(同じidempotency_keyの再送) ===");
  const replay = await rpc("fn_use_card", team1Token, { p_idempotency_key: idem1, p_card_code: "ADVANCE_1" });
  console.log("再送結果:", replay.status, JSON.stringify(replay.body));

  // team1をDICE_READYに戻す
  await admin.from("team_state").update({ state: "DICE_READY", current_turn_id: null }).eq("team_id", team1!.id);

  console.log("\n=== 4. 妨害カード(牛歩)+カードバリアで無効化 ===");
  await grant(team2!.id, "CARD_BARRIER");
  await grant(team1!.id, "SLOW_WALK");
  const idem2 = crypto.randomUUID();
  const use2 = await rpc("fn_use_card", team1Token, { p_idempotency_key: idem2, p_card_code: "SLOW_WALK", p_target_team_id: team2!.id });
  console.log("fn_use_card(SLOW_WALK→team2, バリア所持):", use2.status, JSON.stringify(use2.body));
  const barrierQty = await admin.from("team_cards").select("quantity").eq("team_id", team2!.id).eq("card_id", (await admin.from("cards").select("id").eq("card_code", "CARD_BARRIER").single()).data!.id).maybeSingle();
  console.log("バリア消費後の所持数(0のはず):", barrierQty.data?.quantity);

  console.log("\n=== 5. 強奪カード(コイン20%奪取) ===");
  await grant(team1!.id, "COIN_ROB");
  const beforeCoin1 = await admin.from("team_state").select("coin_balance_cache").eq("team_id", team1!.id).single();
  const beforeCoin2 = await admin.from("team_state").select("coin_balance_cache").eq("team_id", team2!.id).single();
  const idem3 = crypto.randomUUID();
  const use3 = await rpc("fn_use_card", team1Token, { p_idempotency_key: idem3, p_card_code: "COIN_ROB", p_target_team_id: team2!.id });
  console.log("fn_use_card(COIN_ROB):", use3.status, JSON.stringify(use3.body));
  const afterCoin1 = await admin.from("team_state").select("coin_balance_cache").eq("team_id", team1!.id).single();
  const afterCoin2 = await admin.from("team_state").select("coin_balance_cache").eq("team_id", team2!.id).single();
  console.log(`team1: ${beforeCoin1.data!.coin_balance_cache} -> ${afterCoin1.data!.coin_balance_cache}`);
  console.log(`team2: ${beforeCoin2.data!.coin_balance_cache} -> ${afterCoin2.data!.coin_balance_cache}(20%減少のはず)`);

  console.log("\n=== 6. 宝くじカード ===");
  await grant(team1!.id, "LOTTERY");
  const beforeLottery = await admin.from("team_state").select("coin_balance_cache").eq("team_id", team1!.id).single();
  const idem4 = crypto.randomUUID();
  const use4 = await rpc("fn_use_card", team1Token, { p_idempotency_key: idem4, p_card_code: "LOTTERY" });
  console.log("fn_use_card(LOTTERY):", use4.status, JSON.stringify(use4.body));
  const afterLottery = await admin.from("team_state").select("coin_balance_cache").eq("team_id", team1!.id).single();
  console.log(`コイン: ${beforeLottery.data!.coin_balance_cache} -> ${afterLottery.data!.coin_balance_cache}`);

  console.log("\n=== 7. 引換券カード ===");
  await grant(team1!.id, "VOUCHER");
  const idem5 = crypto.randomUUID();
  const use5 = await rpc("fn_use_card", team1Token, { p_idempotency_key: idem5, p_card_code: "VOUCHER", p_payload: { target_card_code: "ADVANCE_2" } });
  console.log("fn_use_card(VOUCHER→ADVANCE_2):", use5.status, JSON.stringify(use5.body));

  console.log("\n=== 8. カード所持していないのに使用しようとする ===");
  const idem6 = crypto.randomUUID();
  const use6 = await rpc("fn_use_card", team1Token, { p_idempotency_key: idem6, p_card_code: "NOZOMI" });
  console.log("fn_use_card(未所持カード):", use6.status, "(400/エラーのはず)", JSON.stringify(use6.body));

  console.log("\n=== 9. 徳政令カード(無効化されているはず) ===");
  const debtForgiveCard = await admin.from("cards").select("enabled").eq("card_code", "DEBT_FORGIVE").single();
  console.log("DEBT_FORGIVE.enabled:", debtForgiveCard.data?.enabled, debtForgiveCard.data?.enabled === false ? "OK" : "NG");

  console.log("\n=== 10. ゲーム終了時の残カード償却ログ ===");
  await grant(team1!.id, "NOZOMI", 2);
  await rpc("fn_admin_force_end_event", staffToken, { p_reason: "test" });
  const { data: writeOffLog } = await admin
    .from("audit_log")
    .select("*")
    .eq("event_id", eventId)
    .eq("team_id", team1!.id)
    .eq("action_type", "CARDS_WRITTEN_OFF")
    .order("created_at", { ascending: false })
    .limit(1);
  console.log("償却ログ:", JSON.stringify(writeOffLog));
  const finalCoin = await admin.from("team_state").select("coin_balance_cache").eq("team_id", team1!.id).single();
  console.log("残カードはコインに加算されていないはず。最終コイン:", finalCoin.data!.coin_balance_cache);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
