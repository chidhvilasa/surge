// Surge — shared types.
// In "vs_ai" mode, Player A is the human and Player B is the agent. In
// "hotseat" mode both sides are human, sharing the same device.

export type Player = "A" | "B";
export type Difficulty = "easy" | "medium" | "hard";
export type GameMode = "vs_ai" | "hotseat";
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

// The exact three literal strings backend/rules_engine/moves.py assigns to
// state.win_reason -- confirmed directly against that source, not assumed.
// mock.ts produces the same three strings, so the mock and the real API are
// interchangeable here.
export type WinReason = "back_row" | "elimination" | "no_legal_moves";

export type GameState = {
  game_id: string;
  board: Board;
  current_player: Player;
  surge_tokens: { A: number; B: number };
  exposed: Exposed;
  legal_moves: Move[];
  winner: Player | null;
  win_reason?: WinReason;
  difficulty: Difficulty;
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