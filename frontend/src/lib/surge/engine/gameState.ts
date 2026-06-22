// Ported 1:1 from backend/rules_engine/game_state.py.
// Game state: board + Surge tokens + Exposed status + whose turn it is.

import { Board, PLAYER_A, type Player } from "./board";

export const STARTING_SURGE_TOKENS = 3;

export type Pos = [number, number];

// An Exposed piece: position and the owner (whose piece it is).
export interface Exposed {
  pos: Pos;
  owner: Player;
}

export type ActionKey = [Pos, Pos, string]; // from_pos, to_pos, move_type

// Python's state_key() returns a hashable tuple used directly as a dict
// key. JS objects/arrays aren't usable as Map keys by value, so this is a
// canonical JSON string instead -- functionally equivalent (same
// information, same collision behavior), the one other deliberate
// adaptation in this port besides Board.equals().
export type StateKey = string;
export type HistoryEntry = [StateKey, ActionKey, Player];

export interface GameStateInit {
  board?: Board;
  currentPlayer?: Player;
  surgeTokens?: Record<Player, number>;
  exposed?: Exposed | null;
  winner?: Player | null;
  winReason?: string | null;
  turnNumber?: number;
  history?: HistoryEntry[];
}

// Full state of a Surge game. Treated as immutable: applyMove() returns a
// new GameState rather than mutating this one.
export class GameState {
  board: Board;
  currentPlayer: Player;
  surgeTokens: Record<Player, number>;
  exposed: Exposed | null;
  winner: Player | null;
  winReason: string | null;
  turnNumber: number;
  history: HistoryEntry[];

  constructor(opts: GameStateInit = {}) {
    this.board = opts.board ?? Board.initial();
    this.currentPlayer = opts.currentPlayer ?? PLAYER_A;
    this.surgeTokens = opts.surgeTokens
      ? { ...opts.surgeTokens }
      : { A: STARTING_SURGE_TOKENS, B: STARTING_SURGE_TOKENS };
    this.exposed = opts.exposed ?? null;
    this.winner = opts.winner ?? null;
    this.winReason = opts.winReason ?? null;
    this.turnNumber = opts.turnNumber ?? 1;
    this.history = opts.history ? [...opts.history] : [];
  }

  clone(): GameState {
    return new GameState({
      board: this.board.clone(),
      currentPlayer: this.currentPlayer,
      surgeTokens: { ...this.surgeTokens },
      exposed: this.exposed,
      winner: this.winner,
      winReason: this.winReason,
      turnNumber: this.turnNumber,
      history: this.history,
    });
  }

  isOver(): boolean {
    return this.winner !== null;
  }

  stateKey(): StateKey {
    const exposedKey = this.exposed ? [this.exposed.pos, this.exposed.owner] : null;
    return JSON.stringify([
      this.board.grid,
      this.currentPlayer,
      this.surgeTokens.A,
      this.surgeTokens.B,
      exposedKey,
    ]);
  }
}
