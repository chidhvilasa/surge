// Single swap point for where win/loss stats are persisted, mirroring how
// client.ts isolates its data source. Backing store is picked at runtime:
// chrome.storage.local when running inside the extension (chrome.storage
// exists), localStorage otherwise (the regular web app). Same STORAGE_KEY,
// same flat SurgeStats shape, same call sites in SurgeGame.tsx -- only the
// storage calls' bodies differ.
//
// chrome.storage.local's API is Promise-based (Chrome 88+, well within
// Manifest V3's minimum), so this module's exports are uniformly async even
// though the localStorage path itself is synchronous under the hood.

export type SurgeStats = {
  gamesPlayed: number;
  humanWins: number;
  agentWins: number;
  currentStreak: { type: "win" | "loss" | null; count: number };
};

const STORAGE_KEY = "surge_stats";

const DEFAULT_STATS: SurgeStats = {
  gamesPlayed: 0,
  humanWins: 0,
  agentWins: 0,
  currentStreak: { type: null, count: 0 },
};

function hasChromeStorage(): boolean {
  return (
    typeof chrome !== "undefined" &&
    typeof chrome.storage !== "undefined" &&
    typeof chrome.storage.local !== "undefined"
  );
}

async function readRaw(): Promise<string | null> {
  if (hasChromeStorage()) {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const value = result[STORAGE_KEY];
    return typeof value === "string" ? value : null;
  }
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

async function writeRaw(raw: string): Promise<void> {
  if (hasChromeStorage()) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: raw });
    } catch (e) {
      // Quota exceeded or storage otherwise unavailable -- stats just
      // won't persist this session, not a crash.
      console.warn("Surge: failed to save stats to chrome.storage.local", e);
    }
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // localStorage unavailable (private mode, quota, etc.) -- stats just
    // won't persist this session, not a crash.
  }
}

export async function loadStats(): Promise<SurgeStats> {
  const raw = await readRaw();
  if (!raw) return { ...DEFAULT_STATS };
  try {
    const parsed = JSON.parse(raw) as Partial<SurgeStats>;
    return {
      gamesPlayed: parsed.gamesPlayed ?? 0,
      humanWins: parsed.humanWins ?? 0,
      agentWins: parsed.agentWins ?? 0,
      currentStreak: parsed.currentStreak ?? { type: null, count: 0 },
    };
  } catch {
    return { ...DEFAULT_STATS };
  }
}

// Records one finished human-vs-agent game's result and returns the updated
// stats. `winner` is "A" (human) or "B" (agent). Call this exactly once per
// finished game_id -- the caller (SurgeGame.tsx) is responsible for the
// already-recorded guard, the same bug class the backend's
// record_finished_game() guards against for the same reason.
export async function recordResult(winner: "A" | "B"): Promise<SurgeStats> {
  const stats = await loadStats();
  const result: "win" | "loss" = winner === "A" ? "win" : "loss";

  const nextStreak =
    stats.currentStreak.type === result
      ? { type: result, count: stats.currentStreak.count + 1 }
      : { type: result, count: 1 };

  const next: SurgeStats = {
    gamesPlayed: stats.gamesPlayed + 1,
    humanWins: stats.humanWins + (result === "win" ? 1 : 0),
    agentWins: stats.agentWins + (result === "loss" ? 1 : 0),
    currentStreak: nextStreak,
  };
  await writeRaw(JSON.stringify(next));
  return next;
}
