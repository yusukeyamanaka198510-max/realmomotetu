import { describe, it, expect, beforeAll } from "vitest";
import { admin, ensureEventRunning, getStationByName } from "./setup";

/**
 * Seed路線図(scripts/seed.ts):
 *   山手線(環状): A-B-C-D-E-F-A
 *   中央線      : C-G-H-I (Cで山手線と乗換)
 *   支線(行き止まり): I-J (Iで中央線と乗換)
 */
describe("経路探索 fn_reachable_stations", () => {
  let eventId: string;
  const nameOf = new Map<string, string>();

  beforeAll(async () => {
    eventId = await ensureEventRunning();
  });

  async function reachable(stationName: string, n: number, relaxed: boolean) {
    const station = await getStationByName(eventId, stationName);
    const { data, error } = await admin.rpc("fn_reachable_stations", {
      p_start: station.id,
      p_event_id: eventId,
      p_n: n,
      p_relaxed: relaxed,
    });
    if (error) throw error;
    const ids: string[] = (data ?? []).map((r: { station_id: string }) => r.station_id);
    if (nameOf.size === 0) {
      const { data: stations } = await admin.from("stations").select("id, name").eq("event_id", eventId);
      stations?.forEach((s) => nameOf.set(s.id, s.name));
    }
    return ids.map((id) => nameOf.get(id)).sort();
  }

  it("出目ぴったりの駅のみ到達可能(途中駅は含まれない)", async () => {
    expect(await reachable("A駅", 1, false)).toEqual(["B駅", "F駅"]);
  });

  it("複数候補を正しく算出する(2駅先)", async () => {
    expect(await reachable("A駅", 2, false)).toEqual(["C駅", "E駅"]);
  });

  it("路線乗り換えを許可する(山手線→中央線をまたぐ経路が候補に入る)", async () => {
    // A駅から4駅先: 山手線のみのE駅、山手線→中央線乗換のH駅、往復乗換のC駅が候補
    expect(await reachable("A駅", 4, false)).toEqual(["C駅", "E駅", "H駅"]);
  });

  it("同一ターン内で同じ駅を2度通るルートは除外する(行き止まり路線での唯一経路)", async () => {
    // J駅(行き止まり)から3駅先はJ→I→H→Gの1経路のみ
    expect(await reachable("J駅", 3, false)).toEqual(["G駅"]);
  });

  it("多分岐で複数候補が出る(ハブ駅Cを経由)", async () => {
    expect(await reachable("J駅", 5, false)).toEqual(["B駅", "D駅"]);
    expect(await reachable("J駅", 6, false)).toEqual(["A駅", "E駅"]);
  });

  it("緩和モードでは再訪を許容し候補が増える", async () => {
    const strict = await reachable("J駅", 2, false);
    const relaxed = await reachable("J駅", 2, true);
    expect(strict).toEqual(["H駅"]);
    expect(relaxed.length).toBeGreaterThan(strict.length);
  });

  it("出目0以下は到達可能駅なし", async () => {
    expect(await reachable("A駅", 0, false)).toEqual([]);
  });
});
