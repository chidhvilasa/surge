// Ported from backend/agent/mcts_agent.py -- live MCTS with UCB1
// exploration only. Deliberately has NO load()/save() and starts with a
// completely empty table: this phase needs no precomputed policy to
// function, matching the original Python agent's "blank table" benchmark
// (snapshot_5000 vs a from-scratch MCTSAgent). Persistence (the Python
// version's pickle-to-disk) doesn't have a browser-extension equivalent
// decided yet -- chrome.storage is the likely answer, but that's explicitly
// out of scope for this round (flagged in EXTENSION_PHASE1_2_LOG.md).
import type { Player } from "./board";
import type { GameState, HistoryEntry, StateKey } from "./gameState";
import { applyMove, generateLegalMoves, type Move } from "./moves";

// Python's move_key() returns a hashable tuple used directly as a dict
// key. Same adaptation as StateKey in gameState.ts: a canonical JSON
// string instead, built from the exact same [from_pos, to_pos, move_type]
// shape as the Python tuple and as HistoryEntry's ActionKey, so
// updateFromTrajectory's history entries serialize identically to moves
// generated fresh by this agent.
export function moveKey(move: Move): string {
  return JSON.stringify([move.fromPos, move.toPos, move.moveType]);
}

type Stats = [number, number]; // [visitCount, totalValue]
type PathEntry = [StateKey, string, Player];

export interface MCTSAgentOptions {
  explorationC?: number;
  nSimulations?: number;
  rolloutDepthCap?: number;
  rng?: () => number; // returns a float in [0, 1), like Math.random
}

export class MCTSAgent {
  c: number;
  nSimulations: number;
  rolloutDepthCap: number;
  rng: () => number;
  // stateKey -> (actionKey -> [visitCount, totalValue])
  table: Map<StateKey, Map<string, Stats>>;

  constructor(opts: MCTSAgentOptions = {}) {
    this.c = opts.explorationC ?? 1.4;
    this.nSimulations = opts.nSimulations ?? 150;
    this.rolloutDepthCap = opts.rolloutDepthCap ?? 150;
    this.rng = opts.rng ?? Math.random;
    this.table = new Map();
  }

  private ucbSelect(stateKey: StateKey, legalMoves: Move[]): Move {
    const node = this.table.get(stateKey);
    let totalN = 1;
    if (node) {
      for (const m of legalMoves) {
        const s = node.get(moveKey(m));
        if (s) totalN += s[0];
      }
    }
    const logTotal = Math.log(totalN);

    let bestMove = legalMoves[0];
    let bestScore = -Infinity;
    for (const m of legalMoves) {
      const stats = node?.get(moveKey(m));
      if (!stats || stats[0] === 0) {
        return m; // always try an unvisited action first
      }
      const [n, w] = stats;
      const q = w / n;
      const u = this.c * Math.sqrt(logTotal / n);
      const score = q + u;
      if (score > bestScore) {
        bestScore = score;
        bestMove = m;
      }
    }
    return bestMove;
  }

  private rolloutPolicy(legalMoves: Move[]): Move {
    const idx = Math.floor(this.rng() * legalMoves.length);
    return legalMoves[idx];
  }

  private simulate(rootState: GameState): void {
    const path: PathEntry[] = [];
    let state = rootState;
    let depth = 0;
    let expandedNewNode = false;

    while (!state.isOver() && depth < this.rolloutDepthCap && !expandedNewNode) {
      const legal = generateLegalMoves(state);
      if (legal.length === 0) break;
      const stateKey = state.stateKey();
      const move = this.ucbSelect(stateKey, legal);
      const actionKey = moveKey(move);
      path.push([stateKey, actionKey, state.currentPlayer]);

      const node = this.table.get(stateKey);
      const stats = node?.get(actionKey);
      if (!stats || stats[0] === 0) {
        expandedNewNode = true;
      }

      // move came straight out of generateLegalMoves(state) above, so
      // it's legal in this exact state by construction -- skip the
      // redundant re-validation applyMove would otherwise do.
      state = applyMove(state, move, false);
      depth += 1;
    }

    // Rollout to terminal with a uniform-random policy.
    while (!state.isOver() && depth < this.rolloutDepthCap) {
      const legal = generateLegalMoves(state);
      if (legal.length === 0) break;
      state = applyMove(state, this.rolloutPolicy(legal), false);
      depth += 1;
    }

    this.backpropagate(path, state.winner);
  }

  private backpropagate(path: PathEntry[], winner: Player | null): void {
    for (const [stateKey, actionKey, player] of path) {
      let node = this.table.get(stateKey);
      if (!node) {
        node = new Map();
        this.table.set(stateKey, node);
      }
      let stats = node.get(actionKey);
      if (!stats) {
        stats = [0, 0];
        node.set(actionKey, stats);
      }
      stats[0] += 1;
      let result: number;
      if (winner === null) result = 0;
      else if (winner === player) result = 1;
      else result = -1;
      stats[1] += result;
    }
  }

  // Fold a real, already-played game's trajectory into the table using
  // the same backup rule as self-play, without running any new simulated
  // rollouts.
  updateFromTrajectory(history: HistoryEntry[], winner: Player | null): void {
    const path: PathEntry[] = history.map(([stateKey, actionKey, player]) => [
      stateKey,
      JSON.stringify(actionKey),
      player,
    ]);
    this.backpropagate(path, winner);
  }

  search(state: GameState): Move {
    if (state.isOver()) {
      throw new Error("Cannot search from a terminal state");
    }

    for (let i = 0; i < this.nSimulations; i++) {
      this.simulate(state);
    }

    const legal = generateLegalMoves(state);
    const node = this.table.get(state.stateKey());

    const robustness = (m: Move): [number, number] => {
      const stats = node?.get(moveKey(m));
      if (!stats || stats[0] === 0) return [0, -Infinity];
      const [n, w] = stats;
      return [n, w / n];
    };

    let best = legal[0];
    let bestR = robustness(best);
    for (const m of legal.slice(1)) {
      const r = robustness(m);
      if (r[0] > bestR[0] || (r[0] === bestR[0] && r[1] > bestR[1])) {
        best = m;
        bestR = r;
      }
    }
    return best;
  }

  chooseMove(state: GameState): Move {
    return this.search(state);
  }
}
