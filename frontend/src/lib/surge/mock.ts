// Mock Surge backend. Single in-memory game store keyed by game_id.
// Player A is always the human, Player B is always the agent.
// Rules:
//  - Standard: 1 step forward (straight only into empty; diagonal into empty or enemy).
//  - Surge: 2 squares straight forward, jumping middle (ignored). Dest empty or enemy.
//    Costs 1 token, sets exposed = { pos: dest, owner: mover } until mover's next turn.
//  - Exposed capture: any of the 8 neighbours of state.exposed.pos that holds an
//    enemy of exposed.owner may capture onto exposed.pos. Free, any direction.
//  - Win: breakthrough (reach opposite back rank), elimination, or stalemate-as-loss.

import type {
  Board,
  Cell,
  Exposed,
  GameState,
  Move,
  Player,
  Pos,
  WinReason,
} from "./types";
import { COLS, ROWS, samePos } from "./types";

type InternalState = Omit<GameState, "legal_moves" | "winner" | "win_reason"> & {
  // legal_moves / winner / win_reason are derived on read.
};

const store = new Map<string, InternalState>();

function makeInitialBoard(): Board {
  const board: Board = [];
  for (let r = 0; r < ROWS; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < COLS; c++) {
      if (r === 0) row.push("A");
      else if (r === ROWS - 1) row.push("B");
      else row.push(null);
    }
    board.push(row);
  }
  return board;
}

function newGameId(): string {
  return `g_${Math.random().toString(36).slice(2, 10)}`;
}

function clone(s: InternalState): InternalState {
  return {
    game_id: s.game_id,
    board: s.board.map((row) => row.slice()),
    current_player: s.current_player,
    surge_tokens: { ...s.surge_tokens },
    exposed: s.exposed ? { pos: [s.exposed.pos[0], s.exposed.pos[1]], owner: s.exposed.owner } : null,
    difficulty: s.difficulty,
  };
}

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

function forwardDir(player: Player): number {
  return player === "A" ? +1 : -1;
}

function enemyOf(p: Player): Player {
  return p === "A" ? "B" : "A";
}

function countPieces(board: Board, p: Player): number {
  let n = 0;
  for (const row of board) for (const c of row) if (c === p) n++;
  return n;
}

function reachedBackRank(board: Board, p: Player): boolean {
  const targetRow = p === "A" ? ROWS - 1 : 0;
  for (let c = 0; c < COLS; c++) if (board[targetRow][c] === p) return true;
  return false;
}

function generateLegalMoves(s: InternalState): Move[] {
  const moves: Move[] = [];
  const me = s.current_player;
  const enemy = enemyOf(me);
  const dr = forwardDir(me);

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (s.board[r][c] !== me) continue;
      const from: Pos = [r, c];

      // Standard forward-straight (empty only)
      const fr = r + dr;
      if (inBounds(fr, c) && s.board[fr][c] === null) {
        moves.push({ from_pos: from, to_pos: [fr, c], move_type: "standard_move" });
      }

      // Standard forward-diagonal (empty or enemy)
      for (const dc of [-1, +1]) {
        const nc = c + dc;
        if (inBounds(fr, nc)) {
          const t = s.board[fr][nc];
          if (t === null || t === enemy) {
            moves.push({ from_pos: from, to_pos: [fr, nc], move_type: "standard_move" });
          }
        }
      }

      // Surge: two squares straight forward, jump middle.
      if (s.surge_tokens[me] > 0) {
        const sr = r + 2 * dr;
        if (inBounds(sr, c)) {
          const t = s.board[sr][c];
          if (t === null || t === enemy) {
            moves.push({ from_pos: from, to_pos: [sr, c], move_type: "surge_move" });
          }
        }
      }
    }
  }

  // Exposed captures
  if (s.exposed) {
    const target = s.exposed.pos;
    const victimEnemy = enemyOf(s.exposed.owner); // who may capture onto target
    if (victimEnemy === me) {
      for (let dr2 = -1; dr2 <= 1; dr2++) {
        for (let dc2 = -1; dc2 <= 1; dc2++) {
          if (dr2 === 0 && dc2 === 0) continue;
          const nr = target[0] + dr2;
          const nc = target[1] + dc2;
          if (!inBounds(nr, nc)) continue;
          if (s.board[nr][nc] === me) {
            moves.push({
              from_pos: [nr, nc],
              to_pos: [target[0], target[1]],
              move_type: "exposed_capture",
            });
          }
        }
      }
    }
  }

  return moves;
}

function computeWinner(s: InternalState): { winner: Player | null; reason?: WinReason } {
  // Reason strings match the real backend exactly (backend/rules_engine/moves.py)
  // so the mock and the real API are interchangeable from the UI's perspective.
  if (reachedBackRank(s.board, "A")) return { winner: "A", reason: "back_row" };
  if (reachedBackRank(s.board, "B")) return { winner: "B", reason: "back_row" };
  if (countPieces(s.board, "A") === 0) return { winner: "B", reason: "elimination" };
  if (countPieces(s.board, "B") === 0) return { winner: "A", reason: "elimination" };
  const legal = generateLegalMoves(s);
  if (legal.length === 0) {
    return { winner: enemyOf(s.current_player), reason: "no_legal_moves" };
  }
  return { winner: null };
}

function toPublic(s: InternalState): GameState {
  const { winner, reason } = computeWinner(s);
  const legal_moves = winner ? [] : generateLegalMoves(s);
  return {
    game_id: s.game_id,
    board: s.board.map((row) => row.slice()),
    current_player: s.current_player,
    surge_tokens: { ...s.surge_tokens },
    exposed: s.exposed ? { pos: [s.exposed.pos[0], s.exposed.pos[1]], owner: s.exposed.owner } : null,
    legal_moves,
    winner,
    win_reason: reason,
    difficulty: s.difficulty,
  };
}

function delay(min: number, max: number): Promise<void> {
  const ms = Math.floor(min + Math.random() * (max - min));
  return new Promise((res) => setTimeout(res, ms));
}

export async function mockCreateGame(difficulty: GameState["difficulty"] = "hard"): Promise<GameState> {
  await delay(80, 180);
  const id = newGameId();
  const s: InternalState = {
    game_id: id,
    board: makeInitialBoard(),
    current_player: "A",
    surge_tokens: { A: 3, B: 3 },
    exposed: null,
    difficulty,
  };
  store.set(id, s);
  return toPublic(s);
}

function findMove(legal: Move[], m: Move): Move | null {
  return (
    legal.find(
      (x) =>
        x.move_type === m.move_type &&
        samePos(x.from_pos, m.from_pos) &&
        samePos(x.to_pos, m.to_pos),
    ) ?? null
  );
}

function applyMove(s: InternalState, move: Move): void {
  const mover = s.current_player;
  const [fr, fc] = move.from_pos;
  const [tr, tc] = move.to_pos;

  if (move.move_type === "exposed_capture") {
    // Remove victim (the exposed piece) and place mover there.
    s.board[tr][tc] = mover;
    s.board[fr][fc] = null;
    // Exposed window closes.
    s.exposed = null;
  } else if (move.move_type === "surge_move") {
    // Destination may have enemy → captured.
    s.board[tr][tc] = mover;
    s.board[fr][fc] = null;
    s.surge_tokens[mover] = Math.max(0, s.surge_tokens[mover] - 1);
    s.exposed = { pos: [tr, tc], owner: mover };
  } else {
    // standard_move
    s.board[tr][tc] = mover;
    s.board[fr][fc] = null;
  }

  // Hand off turn.
  const next: Player = enemyOf(mover);
  s.current_player = next;

  // Clear exposed at the start of its owner's next turn.
  if (s.exposed && s.exposed.owner === s.current_player) {
    s.exposed = null;
  }
}

export async function mockSubmitMove(gameId: string, move: Move): Promise<GameState> {
  await delay(80, 160);
  const s = store.get(gameId);
  if (!s) throw new Error(`Unknown game ${gameId}`);
  const legal = generateLegalMoves(s);
  const m = findMove(legal, move);
  if (!m) throw new Error(`Illegal move`);
  applyMove(s, m);
  return toPublic(s);
}

export async function mockRequestAgentMove(
  gameId: string,
): Promise<{ movePlayed: Move; state: GameState }> {
  await delay(400, 800);
  const s = store.get(gameId);
  if (!s) throw new Error(`Unknown game ${gameId}`);
  if (s.current_player !== "B") throw new Error(`Not agent's turn`);
  const legal = generateLegalMoves(s);
  if (legal.length === 0) {
    // Stalemate — return current state with no move; UI shouldn't get here because winner is set.
    return { movePlayed: legal[0], state: toPublic(s) };
  }
  const choice = legal[Math.floor(Math.random() * legal.length)];
  applyMove(s, choice);
  return { movePlayed: choice, state: toPublic(s) };
}