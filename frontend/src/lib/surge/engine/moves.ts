// Ported 1:1 from backend/rules_engine/moves.py.
// Legal move generation and move application for Surge.

import { BACK_ROW, Board, FORWARD, opponentOf, type Player } from "./board";
import { GameState, type Exposed, type Pos } from "./gameState";

export const STANDARD_MOVE = "standard_move";
export const STANDARD_CAPTURE = "standard_capture";
export const SURGE_MOVE = "surge_move";
export const SURGE_CAPTURE = "surge_capture";
export const EXPOSED_CAPTURE = "exposed_capture";

export type MoveType =
  | typeof STANDARD_MOVE
  | typeof STANDARD_CAPTURE
  | typeof SURGE_MOVE
  | typeof SURGE_CAPTURE
  | typeof EXPOSED_CAPTURE;

const CAPTURE_TYPES = new Set<MoveType>([STANDARD_CAPTURE, SURGE_CAPTURE, EXPOSED_CAPTURE]);
const SURGE_TYPES = new Set<MoveType>([SURGE_MOVE, SURGE_CAPTURE]);

export interface Move {
  fromPos: Pos;
  toPos: Pos;
  moveType: MoveType;
  player: Player;
}

export function isCapture(move: Move): boolean {
  return CAPTURE_TYPES.has(move.moveType);
}

export function isSurge(move: Move): boolean {
  return SURGE_TYPES.has(move.moveType);
}

function edgeKey(from: Pos, to: Pos): string {
  return `${from[0]},${from[1]}->${to[0]},${to[1]}`;
}

export function generatePieceStandardMoves(state: GameState, pos: Pos): Move[] {
  const [row, col] = pos;
  const player = state.board.get(row, col);
  if (player === null) return [];
  const board = state.board;
  const d = FORWARD[player];
  const moves: Move[] = [];

  const straight: Pos = [row + d, col];
  if (Board.inBounds(straight[0], straight[1]) && board.isEmpty(straight[0], straight[1])) {
    moves.push({ fromPos: pos, toPos: straight, moveType: STANDARD_MOVE, player });
  }

  for (const dest of [[row + d, col - 1] as Pos, [row + d, col + 1] as Pos]) {
    if (!Board.inBounds(dest[0], dest[1])) continue;
    const occupant = board.get(dest[0], dest[1]);
    if (occupant === null) {
      moves.push({ fromPos: pos, toPos: dest, moveType: STANDARD_MOVE, player });
    } else if (occupant !== player) {
      moves.push({ fromPos: pos, toPos: dest, moveType: STANDARD_CAPTURE, player });
    }
  }

  return moves;
}

export function generatePieceSurgeMoves(state: GameState, pos: Pos): Move[] {
  const [row, col] = pos;
  const player = state.board.get(row, col);
  if (player === null || state.surgeTokens[player] <= 0) return [];
  const board = state.board;
  const d = FORWARD[player];
  const dest: Pos = [row + 2 * d, col];
  if (!Board.inBounds(dest[0], dest[1])) return [];
  const occupant = board.get(dest[0], dest[1]);
  if (occupant === player) return [];
  const moveType = occupant !== null ? SURGE_CAPTURE : SURGE_MOVE;
  return [{ fromPos: pos, toPos: dest, moveType, player }];
}

function exposedCaptureMoves(state: GameState, player: Player, existing: Set<string>): Move[] {
  const exposed: Exposed | null = state.exposed;
  if (exposed === null || exposed.owner === player) return [];
  const board = state.board;
  const [er, ec] = exposed.pos;
  const moves: Move[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = er + dr;
      const c = ec + dc;
      if (!Board.inBounds(r, c)) continue;
      if (board.get(r, c) !== player) continue;
      const key = edgeKey([r, c], exposed.pos);
      if (existing.has(key)) continue;
      moves.push({ fromPos: [r, c], toPos: exposed.pos, moveType: EXPOSED_CAPTURE, player });
    }
  }
  return moves;
}

// All legal moves for `player` (default: state.currentPlayer).
export function generateLegalMoves(state: GameState, player?: Player): Move[] {
  const p = player ?? state.currentPlayer;
  const moves: Move[] = [];
  const seen = new Set<string>();
  for (const pos of Array.from(state.board.piecesOf(p))) {
    for (const mv of generatePieceStandardMoves(state, pos)) {
      moves.push(mv);
      seen.add(edgeKey(mv.fromPos, mv.toPos));
    }
    for (const mv of generatePieceSurgeMoves(state, pos)) {
      moves.push(mv);
      seen.add(edgeKey(mv.fromPos, mv.toPos));
    }
  }
  moves.push(...exposedCaptureMoves(state, p, seen));
  return moves;
}

// Return a new GameState with `move` applied. Throws if the move is not
// legal in `state` and `validate` is true (the default).
//
// `validate=false` is for hot-path callers (e.g. MCTS simulation) that
// already drew `move` from this exact state's own generateLegalMoves()
// result and so don't need it re-derived and re-checked a second time.
export function applyMove(state: GameState, move: Move, validate = true): GameState {
  if (move.player !== state.currentPlayer) {
    throw new Error("Move player does not match current_player");
  }

  if (validate) {
    const legal = generateLegalMoves(state, move.player);
    const found = legal.some(
      (m) =>
        m.fromPos[0] === move.fromPos[0] &&
        m.fromPos[1] === move.fromPos[1] &&
        m.toPos[0] === move.toPos[0] &&
        m.toPos[1] === move.toPos[1] &&
        m.moveType === move.moveType,
    );
    if (!found) throw new Error(`Illegal move: ${JSON.stringify(move)}`);
  }

  const newState = state.clone();
  const board = newState.board;
  const player = move.player;
  const opponent = opponentOf(player);

  newState.history.push([state.stateKey(), [move.fromPos, move.toPos, move.moveType], player]);

  if (isCapture(move)) {
    if (
      newState.exposed !== null &&
      newState.exposed.pos[0] === move.toPos[0] &&
      newState.exposed.pos[1] === move.toPos[1]
    ) {
      newState.exposed = null;
    }
  }

  board.set(move.fromPos[0], move.fromPos[1], null);
  board.set(move.toPos[0], move.toPos[1], player);

  if (isSurge(move)) {
    newState.surgeTokens[player] -= 1;
    newState.exposed = { pos: move.toPos, owner: player };
  }

  if (move.toPos[0] === BACK_ROW[opponent]) {
    newState.winner = player;
    newState.winReason = "back_row";
  } else if (board.count(opponent) === 0) {
    newState.winner = player;
    newState.winReason = "elimination";
  }

  newState.currentPlayer = opponent;
  newState.turnNumber += 1;

  if (newState.exposed !== null && newState.exposed.owner === newState.currentPlayer) {
    newState.exposed = null;
  }

  if (newState.winner === null) {
    if (generateLegalMoves(newState, newState.currentPlayer).length === 0) {
      newState.winner = player;
      newState.winReason = "no_legal_moves";
    }
  }

  return newState;
}
