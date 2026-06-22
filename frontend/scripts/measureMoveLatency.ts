// Node/Bun-runnable, no browser involved. Measures raw JS-engine compute
// time for a single MCTSAgent.search() call at a few simulation counts.
//
// This is explicitly RAW COMPUTE TIME in a server-side JS runtime (Bun),
// NOT real in-browser rendering/performance -- those are different things
// and must not be conflated. Real in-browser numbers (main-thread
// contention with React rendering, GC pauses under browser memory
// pressure, actual extension popup constraints) need a human watching a
// real browser, explicitly out of scope for this round.
//
// Run with: bun run scripts/measureMoveLatency.ts
import { GameState, MCTSAgent } from "../src/lib/surge/engine";

function main(): void {
  const simCounts = [20, 50, 100, 200];
  const trialsPerCount = 10;

  console.log("Raw JS-engine compute time per move (Bun process, fresh blank-table agent + fresh game each trial):");
  console.log("NOT in-browser rendering performance -- see header comment.");
  console.log();

  for (const sims of simCounts) {
    const timings: number[] = [];
    for (let trial = 0; trial < trialsPerCount; trial++) {
      const agent = new MCTSAgent({ nSimulations: sims });
      const state = new GameState();
      const t0 = performance.now();
      agent.search(state);
      timings.push(performance.now() - t0);
    }
    const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
    const min = Math.min(...timings);
    const max = Math.max(...timings);
    console.log(
      `  ${String(sims).padStart(3)} simulations: mean ${mean.toFixed(2)}ms  (min ${min.toFixed(2)}ms, max ${max.toFixed(2)}ms, n=${trialsPerCount})`,
    );
  }
}

main();
