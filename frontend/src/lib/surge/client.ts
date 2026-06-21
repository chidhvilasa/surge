// Single swap point for the Surge backend. Three modes:
//   "mock"  -- in-memory mock rules engine (./mock.ts), no agent.
//   "api"   -- real Python backend over HTTP (set VITE_SURGE_API_BASE_URL).
//   "local" -- the ported TypeScript rules engine + live MCTS agent
//              (./engine), no network calls at all. Used by the Chrome
//              extension build, where there is no backend to call.
// Pick the mode via VITE_SURGE_MODE; default is "api" (the regular web app's
// existing behaviour, unchanged). No UI code changes are required to swap
// between any of the three -- every exported function here returns the same
// shape regardless of mode.
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
import type { GameState, Move, WinReason } from "./types";
import {
  GameState as EngineGameState,
  MCTSAgent,
  applyMove as engineApplyMove,
  generateLegalMoves as engineGenerateLegalMoves,
  type Move as EngineMove,
} from "./engine";
import { loadAgentTable, saveAgentTable } from "./engine/persistence";

type ClientMode = "mock" | "api" | "local";

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const MODE: ClientMode = (env?.VITE_SURGE_MODE as ClientMode | undefined) ?? "api";
const API_BASE_URL = env?.VITE_SURGE_API_BASE_URL ?? "http://localhost:8000";

// ---------- "local" mode: TypeScript engine + live MCTS, no network ----------

const localGames = new Map<string, EngineGameState>();
const recordedLocalGames = new Set<string>();
let localAgent: MCTSAgent | null = null;
let localAgentLoad: Promise<MCTSAgent> | null = null;

// Loads any previously-saved table from chrome.storage.local exactly once
// per session (extension popup/tab lifetime); every later call reuses the
// same in-flight or resolved promise so two near-simultaneous callers can't
// each kick off their own load and clobber each other's table reference.
function ensureLocalAgent(): Promise<MCTSAgent> {
  if (localAgentLoad) return localAgentLoad;
  localAgentLoad = (async () => {
    const agent = new MCTSAgent();
    const table = await loadAgentTable();
    if (table) agent.table = table;
    localAgent = agent;
    return agent;
  })();
  return localAgentLoad;
}

function engineMoveToUi(m: EngineMove): Move {
  return { from_pos: m.fromPos, to_pos: m.toPos, move_type: m.moveType };
}

function engineStateToUi(gameId: string, s: EngineGameState): GameState {
  const legal = s.isOver() ? [] : engineGenerateLegalMoves(s);
  return {
    game_id: gameId,
    board: s.board.grid,
    current_player: s.currentPlayer,
    surge_tokens: { A: s.surgeTokens.A, B: s.surgeTokens.B },
    exposed: s.exposed ? { pos: s.exposed.pos, owner: s.exposed.owner } : null,
    legal_moves: legal.map(engineMoveToUi),
    winner: s.winner,
    win_reason: (s.winReason ?? undefined) as WinReason | undefined,
  };
}

// Folds a just-finished local game's trajectory into the agent's table and
// persists it, exactly once per game_id -- the same guard, for the same
// reason, as the Python backend's recorded_games set. Win/loss *stats*
// recording is a separate concern handled uniformly for every mode in
// SurgeGame.tsx, not here -- this is purely about the agent's own learning
// state, which only "local" mode has at all (mock/api have no client-side
// table to persist).
async function maybeRecordFinishedLocalGame(gameId: string, state: EngineGameState, agent: MCTSAgent): Promise<void> {
  if (!state.isOver() || state.history.length === 0) return;
  if (recordedLocalGames.has(gameId)) return;
  recordedLocalGames.add(gameId);
  agent.updateFromTrajectory(state.history, state.winner);
  await saveAgentTable(agent.table);
}

async function createGameLocal(): Promise<GameState> {
  await ensureLocalAgent();
  const gameId = `local_${Math.random().toString(36).slice(2, 10)}`;
  const state = new EngineGameState();
  localGames.set(gameId, state);
  return engineStateToUi(gameId, state);
}

async function submitMoveLocal(gameId: string, move: Move): Promise<GameState> {
  const state = localGames.get(gameId);
  if (!state) throw new Error(`submitMove failed: unknown game ${gameId}`);
  const engineMove: EngineMove = {
    fromPos: move.from_pos,
    toPos: move.to_pos,
    moveType: move.move_type,
    player: state.currentPlayer,
  };
  const next = engineApplyMove(state, engineMove, true);
  localGames.set(gameId, next);
  const agent = await ensureLocalAgent();
  await maybeRecordFinishedLocalGame(gameId, next, agent);
  return engineStateToUi(gameId, next);
}

async function requestAgentMoveLocal(
  gameId: string,
): Promise<{ movePlayed: Move; state: GameState }> {
  const state = localGames.get(gameId);
  if (!state) throw new Error(`requestAgentMove failed: unknown game ${gameId}`);
  const agent = await ensureLocalAgent();
  const move = agent.search(state);
  const next = engineApplyMove(state, move, false);
  localGames.set(gameId, next);
  await maybeRecordFinishedLocalGame(gameId, next, agent);
  return { movePlayed: engineMoveToUi(move), state: engineStateToUi(gameId, next) };
}

// ---------- exported swap points ----------

export async function createGame(): Promise<GameState> {
  if (MODE === "mock") return mockCreateGame();
  if (MODE === "local") return createGameLocal();
  const res = await fetch(`${API_BASE_URL}/games`, { method: "POST" });
  if (!res.ok) throw new Error(`createGame failed: ${res.status}`);
  return extractState(await res.json(), "create").state;
}

export async function submitMove(gameId: string, move: Move): Promise<GameState> {
  if (MODE === "mock") return mockSubmitMove(gameId, move);
  if (MODE === "local") return submitMoveLocal(gameId, move);
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
  if (MODE === "mock") return mockRequestAgentMove(gameId);
  if (MODE === "local") return requestAgentMoveLocal(gameId);
  const res = await fetch(`${API_BASE_URL}/games/${gameId}/agent-move`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`requestAgentMove failed: ${res.status}`);
  const norm = extractState(await res.json(), "agent-move");
  if (!norm.movePlayed) throw new Error(`agent-move missing move_played`);
  return { movePlayed: norm.movePlayed, state: norm.state };
}
