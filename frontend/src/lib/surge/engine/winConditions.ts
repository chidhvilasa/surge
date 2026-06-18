// Ported 1:1 from backend/rules_engine/win_conditions.py.
// Win/elimination/back-row checks are applied as part of moves.applyMove();
// this module exposes a read-only view of that result plus a standalone
// helper for checking the no-legal-moves condition.

import type { Player } from "./board";
import type { GameState } from "./gameState";
import { generateLegalMoves } from "./moves";

export interface WinResult {
  winner: Player;
  reason: string; // "back_row" | "elimination" | "no_legal_moves"
}

export function checkWinner(state: GameState): WinResult | null {
  if (state.winner === null) return null;
  return { winner: state.winner, reason: state.winReason ?? "" };
}

export function hasNoLegalMoves(state: GameState, player?: Player): boolean {
  const p = player ?? state.currentPlayer;
  return generateLegalMoves(state, p).length === 0;
}
