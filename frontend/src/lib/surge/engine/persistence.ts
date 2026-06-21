// Persists MCTSAgent.table to chrome.storage.local so the extension's
// "improves with real play" behaviour survives across popup/tab closes and
// browser restarts -- the in-browser equivalent of the Python backend's
// pickle-to-disk save, except the table here starts genuinely empty (no
// precomputed snapshot is shipped) and only ever grows from this one
// installation's own games.
//
// Only used by client.ts's "local" mode, which only ever runs inside the
// extension -- chrome.storage.local is assumed available, not feature-
// detected, unlike stats.ts (which is also reachable from the regular web
// app and has to support both backings).
import type { StateKey } from "./gameState";

type Stats = [number, number];
type SerializedTable = [StateKey, [string, Stats][]][];

const STORAGE_KEY = "surge_agent_table";

function hasChromeStorage(): boolean {
  return (
    typeof chrome !== "undefined" &&
    typeof chrome.storage !== "undefined" &&
    typeof chrome.storage.local !== "undefined"
  );
}

export function serializeTable(table: Map<StateKey, Map<string, Stats>>): SerializedTable {
  return Array.from(table.entries()).map(([stateKey, node]) => [
    stateKey,
    Array.from(node.entries()),
  ]);
}

export function deserializeTable(raw: SerializedTable): Map<StateKey, Map<string, Stats>> {
  const table = new Map<StateKey, Map<string, Stats>>();
  for (const [stateKey, entries] of raw) {
    table.set(stateKey, new Map(entries));
  }
  return table;
}

export async function loadAgentTable(): Promise<Map<StateKey, Map<string, Stats>> | null> {
  if (!hasChromeStorage()) return null;
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const raw = result[STORAGE_KEY] as SerializedTable | undefined;
    if (!raw) return null;
    return deserializeTable(raw);
  } catch (e) {
    console.warn("Surge: failed to load agent table from chrome.storage.local", e);
    return null;
  }
}

// Saves `table` to chrome.storage.local. The default quota without the
// unlimitedStorage permission is 5MB -- deliberately not requested here
// (minimum permissions: just "storage"), so a table that grows past that
// over a very long play history would fail to save. That failure is
// caught and logged, not thrown: the game keeps working, it just stops
// accumulating further learning until the table is cleared.
export async function saveAgentTable(table: Map<StateKey, Map<string, Stats>>): Promise<void> {
  if (!hasChromeStorage()) return;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: serializeTable(table) });
  } catch (e) {
    console.warn("Surge: failed to save agent table to chrome.storage.local", e);
  }
}
