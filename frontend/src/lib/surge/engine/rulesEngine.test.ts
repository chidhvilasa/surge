// Ported 1:1 from backend/tests/test_rules_engine.py. Every scenario from
// the Python suite has a passing equivalent here: normal capture, illegal
// own-piece blocking, Surge jump over an occupied intermediate square,
// sideways/backward Exposed capture, one-Surge-per-turn limit, and the
// no-legal-moves loss condition -- using the real win_reason strings
// (back_row, elimination, no_legal_moves), not invented placeholder names.
import { describe, expect, it } from "vitest";

import { Board, PLAYER_A, PLAYER_B } from "./board";
import { GameState, type Exposed } from "./gameState";
import {
  EXPOSED_CAPTURE,
  STANDARD_CAPTURE,
  STANDARD_MOVE,
  SURGE_CAPTURE,
  SURGE_MOVE,
  applyMove,
  generateLegalMoves,
  type Move,
} from "./moves";
import { hasNoLegalMoves } from "./winConditions";

function emptyState(opts: Partial<ConstructorParameters<typeof GameState>[0]> = {}): GameState {
  return new GameState({ board: new Board(), ...opts });
}

function move(
  fromPos: [number, number],
  toPos: [number, number],
  moveType: Move["moveType"],
  player: Move["player"],
): Move {
  return { fromPos, toPos, moveType, player };
}

function exposedEquals(a: Exposed | null, b: Exposed | null): boolean {
  if (a === null || b === null) return a === b;
  return a.pos[0] === b.pos[0] && a.pos[1] === b.pos[1] && a.owner === b.owner;
}

describe("rules engine (ported from test_rules_engine.py)", () => {
  it("normal capture", () => {
    const state = emptyState({ currentPlayer: PLAYER_A });
    state.board.set(2, 2, PLAYER_A);
    state.board.set(3, 3, PLAYER_B);

    const mv = move([2, 2], [3, 3], STANDARD_CAPTURE, PLAYER_A);
    const newState = applyMove(state, mv);

    expect(newState.board.get(3, 3)).toBe(PLAYER_A);
    expect(newState.board.get(2, 2)).toBe(null);
    expect(newState.board.count(PLAYER_B)).toBe(0);
    // Elimination of the only enemy piece is itself a win.
    expect(newState.winner).toBe(PLAYER_A);
    expect(newState.winReason).toBe("elimination");
  });

  it("illegal own-piece blocking", () => {
    const state = emptyState({ currentPlayer: PLAYER_A });
    state.board.set(2, 2, PLAYER_A);
    state.board.set(3, 2, PLAYER_A); // blocks the straight-forward square

    const legal = generateLegalMoves(state, PLAYER_A);
    const blockedTargets = legal
      .filter((m) => m.fromPos[0] === 2 && m.fromPos[1] === 2)
      .map((m) => m.toPos);
    expect(blockedTargets.some((t) => t[0] === 3 && t[1] === 2)).toBe(false);

    const illegalMove = move([2, 2], [3, 2], STANDARD_MOVE, PLAYER_A);
    expect(() => applyMove(state, illegalMove)).toThrow();
  });

  it("Surge jump over an occupied intermediate square", () => {
    const state = emptyState({ currentPlayer: PLAYER_A });
    state.board.set(1, 2, PLAYER_A);
    state.board.set(2, 2, PLAYER_B); // occupied intermediate square, must be ignored
    // destination (3, 2) left empty

    const legal = generateLegalMoves(state, PLAYER_A);
    const surgeMoves = legal.filter(
      (m) => m.moveType === SURGE_MOVE && m.fromPos[0] === 1 && m.fromPos[1] === 2,
    );
    expect(surgeMoves.length).toBe(1);
    expect(surgeMoves[0].toPos).toEqual([3, 2]);

    const newState = applyMove(state, surgeMoves[0]);

    // The intermediate square's occupant is untouched, not captured.
    expect(newState.board.get(2, 2)).toBe(PLAYER_B);
    expect(newState.board.get(1, 2)).toBe(null);
    expect(newState.board.get(3, 2)).toBe(PLAYER_A);
    expect(newState.surgeTokens[PLAYER_A]).toBe(2);
    expect(exposedEquals(newState.exposed, { pos: [3, 2], owner: PLAYER_A })).toBe(true);
  });

  it("Exposed capture from sideways and backward directions", () => {
    // Sideways capture: B's exposed piece sits beside an A piece on the same row.
    const state = emptyState({ currentPlayer: PLAYER_A });
    state.board.set(3, 2, PLAYER_A);
    state.board.set(3, 3, PLAYER_B);
    state.exposed = { pos: [3, 3], owner: PLAYER_B };

    const legal = generateLegalMoves(state, PLAYER_A);
    const exposedMoves = legal.filter((m) => m.moveType === EXPOSED_CAPTURE);
    expect(
      exposedMoves.some(
        (m) => m.fromPos[0] === 3 && m.fromPos[1] === 2 && m.toPos[0] === 3 && m.toPos[1] === 3,
      ),
    ).toBe(true);

    // A sideways move is illegal under standard rules for either player.
    expect(
      legal.some(
        (m) =>
          m.fromPos[0] === 3 &&
          m.fromPos[1] === 2 &&
          m.toPos[0] === 3 &&
          m.toPos[1] === 3 &&
          (m.moveType === STANDARD_MOVE || m.moveType === STANDARD_CAPTURE),
      ),
    ).toBe(false);

    const newState = applyMove(state, move([3, 2], [3, 3], EXPOSED_CAPTURE, PLAYER_A));
    expect(newState.board.get(3, 3)).toBe(PLAYER_A);
    expect(newState.board.get(3, 2)).toBe(null);
    expect(newState.exposed).toBe(null);

    // Backward capture: A's exposed piece sits one row "behind" a B piece
    // relative to B's forward direction (B moves toward decreasing rows).
    const state2 = emptyState({ currentPlayer: PLAYER_B });
    state2.board.set(4, 3, PLAYER_B);
    state2.board.set(3, 3, PLAYER_A);
    state2.exposed = { pos: [3, 3], owner: PLAYER_A };

    const legal2 = generateLegalMoves(state2, PLAYER_B);
    expect(
      legal2.some(
        (m) =>
          m.fromPos[0] === 4 &&
          m.fromPos[1] === 3 &&
          m.toPos[0] === 3 &&
          m.toPos[1] === 3 &&
          m.moveType === EXPOSED_CAPTURE,
      ),
    ).toBe(true);

    const newState2 = applyMove(state2, move([4, 3], [3, 3], EXPOSED_CAPTURE, PLAYER_B));
    expect(newState2.board.get(3, 3)).toBe(PLAYER_B);
    expect(newState2.exposed).toBe(null);
  });

  it("one-Surge-per-turn limit", () => {
    const state = emptyState({
      currentPlayer: PLAYER_A,
      surgeTokens: { A: 3, B: 3 },
    });
    state.board.set(1, 0, PLAYER_A);
    state.board.set(1, 4, PLAYER_A);

    const surgeMove = move([1, 0], [3, 0], SURGE_MOVE, PLAYER_A);
    const newState = applyMove(state, surgeMove);

    // Exactly one token spent.
    expect(newState.surgeTokens[PLAYER_A]).toBe(2);
    // Turn has passed to the opponent, so A structurally cannot spend a
    // second Surge token within the same turn.
    expect(newState.currentPlayer).toBe(PLAYER_B);

    const secondSurge = move([1, 4], [3, 4], SURGE_MOVE, PLAYER_A);
    expect(() => applyMove(newState, secondSurge)).toThrow();

    // Once tokens are exhausted, no further Surge moves are generated.
    const depleted = emptyState({
      currentPlayer: PLAYER_A,
      surgeTokens: { A: 0, B: 3 },
    });
    depleted.board.set(1, 0, PLAYER_A);
    const legal = generateLegalMoves(depleted, PLAYER_A);
    expect(legal.some((m) => m.moveType === SURGE_MOVE || m.moveType === SURGE_CAPTURE)).toBe(false);
  });

  it("no-legal-moves loss condition", () => {
    const state = emptyState({
      currentPlayer: PLAYER_A,
      surgeTokens: { A: 3, B: 0 },
    });

    for (let col = 0; col < 5; col++) state.board.set(0, col, PLAYER_B);
    state.board.set(1, 1, PLAYER_B);
    state.board.set(1, 2, PLAYER_B);
    state.board.set(1, 3, PLAYER_B);
    state.board.set(2, 2, PLAYER_B);
    state.board.set(3, 0, PLAYER_A);

    expect(hasNoLegalMoves(state, PLAYER_B)).toBe(true);

    const mv = move([3, 0], [4, 0], STANDARD_MOVE, PLAYER_A);
    const newState = applyMove(state, mv);

    expect(newState.currentPlayer).toBe(PLAYER_B);
    expect(newState.winner).toBe(PLAYER_A);
    expect(newState.winReason).toBe("no_legal_moves");
  });
});
