// Surge — shared types.
// Player A is always the human, Player B is always the agent.

export type Player = "A" | "B";
export type Cell = Player | null;
export type Board = Cell[][]; // 6 rows × 5 cols; row 0 = A's back rank, row 5 = B's back rank
export type Pos = [number, number]; // [row, col]
export type MoveType =
  | "standard_move"
  | "standard_capture"
  | "surge_move"
  | "surge_capture"
  | "exposed_capture";

export type Move = {
  from_pos: Pos;
  to_pos: Pos;
  move_type: MoveType;
};

export type Exposed = { pos: Pos; owner: Player } | null;

// Real backend values (see backend/rules_engine/win_conditions.py): "back_row",
// "elimination", "no_legal_moves". The mock generator (./mock.ts) and the
// WinBanner/MoveTypeBadge label maps still use the older
// "breakthrough"/"stalemate" naming -- not reconciled here, since picking the
// actual display label/copy is a content decision, not a wiring fix.
export type WinReason = "back_row" | "elimination" | "no_legal_moves" | "breakthrough" | "stalemate";

export type GameState = {
  game_id: string;
  board: Board;
  current_player: Player;
  surge_tokens: { A: number; B: number };
  exposed: Exposed;
  legal_moves: Move[];
  winner: Player | null;
  // NOTE: win_reason values are unverified against the real backend (no game
  // in testing has ended yet). Typed as-is; revisit once a real win occurs.
  win_reason?: WinReason;
};

export const ROWS = 6;
export const COLS = 5;

export function isExposed(state: GameState, pos: Pos): boolean {
  return (
    state.exposed !== null &&
    state.exposed.pos[0] === pos[0] &&
    state.exposed.pos[1] === pos[1]
  );
}

export function samePos(a: Pos, b: Pos): boolean {
  return a[0] === b[0] && a[1] === b[1];
}