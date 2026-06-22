// Node/Bun-runnable, no browser involved. Plays the ported TypeScript
// MCTSAgent (live search, completely blank table -- nothing precomputed
// or loaded from disk) against a uniform-random bot, alternating which
// side the agent plays each game, matching the methodology of the
// original Python benchmark's agent-vs-random evaluation
// (scripts/benchmark_snapshots.py's evaluate_snapshot/play_agent_vs_random).
//
// Run with: bun run scripts/benchmarkEngineVsRandom.ts [games] [simulations]
import {
  GameState,
  MCTSAgent,
  PLAYER_A,
  PLAYER_B,
  applyMove,
  generateLegalMoves,
  type Move,
  type Player,
} from "../src/lib/surge/engine";

// Simple seeded PRNG (mulberry32) for a reproducible run.
function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomChoice(legal: Move[], rng: () => number): Move {
  return legal[Math.floor(rng() * legal.length)];
}

function playOneGame(
  agent: MCTSAgent,
  agentPlayer: Player,
  rng: () => number,
  maxTurns: number,
): Player | null {
  let state = new GameState();
  let turns = 0;
  while (!state.isOver() && turns < maxTurns) {
    const legal = generateLegalMoves(state);
    if (legal.length === 0) break;
    const move = state.currentPlayer === agentPlayer ? agent.search(state) : randomChoice(legal, rng);
    state = applyMove(state, move);
    turns += 1;
  }
  return state.winner;
}

function main(): void {
  const games = Number(process.argv[2] ?? 300);
  const simulations = Number(process.argv[3] ?? 100);
  const maxTurns = 300;
  const rng = makeRng(42);

  // One shared agent instance across all games -- it starts with a blank
  // table and accumulates entries purely from its own search() calls
  // within this run, exactly the same methodology the original Python
  // "blank table" agent used in scripts/benchmark_head_to_head.py.
  const agent = new MCTSAgent({ nSimulations: simulations, rng });

  let wins = 0;
  let undecided = 0;
  const t0 = performance.now();
  for (let i = 0; i < games; i++) {
    const agentPlayer: Player = i % 2 === 0 ? PLAYER_A : PLAYER_B;
    const winner = playOneGame(agent, agentPlayer, rng, maxTurns);
    if (winner === agentPlayer) wins += 1;
    else if (winner === null) undecided += 1;
  }
  const elapsedSec = (performance.now() - t0) / 1000;

  console.log(
    `TypeScript MCTSAgent (blank table at start, ${simulations} simulations/move) vs random bot: ${games} games, sides alternated`,
  );
  console.log(`  agent win rate: ${(wins / games).toFixed(4)} (${wins}/${games})`);
  if (undecided > 0) console.log(`  undecided (hit max_turns with no winner): ${undecided}`);
  console.log(`  elapsed: ${elapsedSec.toFixed(1)}s (${(games / elapsedSec).toFixed(1)} games/sec)`);
  console.log(`  final table size: ${agent.table.size} state entries`);
}

main();
