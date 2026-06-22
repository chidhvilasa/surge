// Single swap point for the Surge backend. Flip USE_MOCK to false and set
// VITE_SURGE_API_BASE_URL to wire a real backend; no UI code changes required.
//
// Endpoint paths/bodies below match backend/api/main.py exactly:
//   POST /games                          -> start a new game
//   POST /games/{game_id}/move           -> { from_pos, to_pos, move_type }
//   POST /games/{game_id}/agent-move     -> (no body)

import { extractState } from "./normalize";
import {
  mockCreateGame,
  mockRequestAgentMove,
  mockSubmitMove,
} from "./mock";
import type { Difficulty, GameState, Move } from "./types";

const USE_MOCK = false;
const API_BASE_URL =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_SURGE_API_BASE_URL ?? "http://localhost:8000";

export async function createGame(difficulty: Difficulty = "hard"): Promise<GameState> {
  if (USE_MOCK) return mockCreateGame(difficulty);
  const res = await fetch(`${API_BASE_URL}/games`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ difficulty }),
  });
  if (!res.ok) throw new Error(`createGame failed: ${res.status}`);
  return extractState(await res.json(), "create").state;
}

export async function submitMove(gameId: string, move: Move): Promise<GameState> {
  if (USE_MOCK) return mockSubmitMove(gameId, move);
  const res = await fetch(`${API_BASE_URL}/games/${gameId}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(move),
  });
  if (!res.ok) throw new Error(`submitMove failed: ${res.status}`);
  return extractState(await res.json(), "submit").state;
}

export async function requestAgentMove(
  gameId: string,
): Promise<{ movePlayed: Move; state: GameState }> {
  if (USE_MOCK) return mockRequestAgentMove(gameId);
  const res = await fetch(`${API_BASE_URL}/games/${gameId}/agent-move`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`requestAgentMove failed: ${res.status}`);
  const norm = extractState(await res.json(), "agent-move");
  if (!norm.movePlayed) throw new Error(`agent-move missing move_played`);
  return { movePlayed: norm.movePlayed, state: norm.state };
}