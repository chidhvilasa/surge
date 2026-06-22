// Single swap point for where win/loss stats are persisted, mirroring how
// client.ts isolates its data source. Today: localStorage. Later (browser
// extension): swap loadStats/saveStats to chrome.storage.local.get/set,
// same STORAGE_KEY, same flat SurgeStats shape, same call sites in
// SurgeGame.tsx -- only the storage calls' bodies change.
//
// One real wrinkle when that swap happens: chrome.storage.local's API is
// async (callback/Promise-based) while localStorage is synchronous. The
// call sites below would need to become async at that point; the data
// shape itself doesn't need to change.

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

export function loadStats(): SurgeStats {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATS };
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

function saveStats(stats: SurgeStats): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // localStorage unavailable (private mode, quota, etc.) -- stats just
    // won't persist this session, not a crash.
  }
}

// Records one finished human-vs-agent game's result and returns the updated
// stats. `winner` is "A" (human) or "B" (agent). Call this exactly once per
// finished game_id -- the caller (SurgeGame.tsx) is responsible for the
// already-recorded guard, the same bug class the backend's
// record_finished_game() guards against for the same reason.
export function recordResult(winner: "A" | "B"): SurgeStats {
  const stats = loadStats();
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
  saveStats(next);
  return next;
}
