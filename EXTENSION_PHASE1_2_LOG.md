# Surge — Chrome Extension, Phases 1-2 Log

Branch: `chrome-extension` (created from `master`, pushed to GitHub, not
merged). This round is logic-only: rules engine port, agent port, Node/Bun
benchmarks. No browser work, no UI, no `client.ts` wiring, nothing merged
into `master`.

## What this round did NOT touch

- `master` branch history — untouched. Branching does not commit anything;
  the pre-existing uncommitted frontend work from the prior session (Part
  B's pending browser verification) was left exactly as it was, regardless
  of which branch is checked out, since uncommitted changes live in the
  working tree, not in a branch's history.
- `backend/` — not touched at all. This is a TypeScript port for the
  extension; the Python original remains the source of truth for the web
  app.
- `frontend/src/lib/surge/client.ts`, any UI component, any extension
  build wiring — explicitly out of scope per the brief, deferred to a
  future round with a human involved.

---

## Step 1: Branch and scaffold

```
$ git checkout -b chrome-extension
Switched to a new branch 'chrome-extension'

$ git push -u origin chrome-extension
remote: Create a pull request for 'chrome-extension' on GitHub by visiting:
remote:      https://github.com/chidhvilasa/surge/pull/new/chrome-extension
branch 'chrome-extension' set up to track 'origin/chrome-extension'.
To https://github.com/chidhvilasa/surge.git
 * [new branch]      chrome-extension -> chrome-extension
```

Created:
- `extension/manifest.json` — placeholder MV3 manifest, explicitly marked
  not functional in its own description field.
- `extension/vite.config.ts` — empty placeholder, comment documents the
  plan to use `@crxjs/vite-plugin` in a future round. Not installed.
- `extension/README.md` — explains the phased plan and points here.
- `extension/icons/.gitkeep` — empty dir placeholder.
- `frontend/src/lib/surge/engine/` — the actual ported code (below).

No second copy of the rules engine or agent exists anywhere — `extension/`
contains zero game logic, exactly as instructed.

---

## Step 2: Rules engine port (Phase 1)

### Test runner setup

`frontend/` had no test runner configured at all (checked: no `vitest`,
no `jest`, no `"test"` script). Added Vitest — the natural choice for a
Vite-based project, since it shares Vite's own config/transform pipeline.

```
$ bun add -d vitest
installed vitest@4.1.9 with binaries:
 - vitest
24 packages installed [10.03s]
```

Added `"test": "vitest run"` to `frontend/package.json`'s scripts.

### Files ported, 1:1, from `backend/rules_engine/`

| Python | TypeScript |
|---|---|
| `board.py` | `frontend/src/lib/surge/engine/board.ts` |
| `game_state.py` | `frontend/src/lib/surge/engine/gameState.ts` |
| `moves.py` | `frontend/src/lib/surge/engine/moves.ts` |
| `win_conditions.py` | `frontend/src/lib/surge/engine/winConditions.ts` |
| `__init__.py` | `frontend/src/lib/surge/engine/index.ts` (barrel) |

### Two deliberate structural adaptations (not bugs, documented in the code too)

1. **`Board.__eq__` → `Board.equals()`.** TypeScript has no operator
   overloading. A method call replaces the `==` operator; behavior is
   identical (deep grid comparison).
2. **`state_key()` / `move_key()` return value.** Python's tuples are
   hashable and used directly as dict keys. JS arrays/objects aren't
   usable as `Map` keys by value. Both now return a canonical JSON string
   instead — same information content, same collision behavior, just a
   string instead of a tuple. This was necessary for the agent's
   table (`Map<StateKey, Map<string, Stats>>`) to work at all in JS.

Everything else — move generation, the Surge jump/Exposed/back-row/
elimination/no-legal-moves logic, the `validate=false` hot-path skip — is
a direct line-for-line translation.

### Test suite port

`backend/tests/test_rules_engine.py`'s 6 tests ported 1:1 to
`frontend/src/lib/surge/engine/rulesEngine.test.ts`, same scenarios, same
assertions, real backend win_reason strings (`back_row`, `elimination`,
`no_legal_moves` — confirmed against `backend/rules_engine/moves.py`
directly in an earlier round, not invented placeholder names):

- normal capture
- illegal own-piece blocking
- Surge jump over an occupied intermediate square
- Exposed capture from sideways and backward directions
- one-Surge-per-turn limit
- no-legal-moves loss condition

### Real test output

```
$ bun run test
$ vitest run
 RUN  v4.1.9 C:/Users/chidh/Downloads/Surge/frontend


 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  21:20:03
   Duration  330ms (transform 113ms, setup 0ms, import 141ms, tests 8ms, environment 0ms)
```

All 6 pass, matching the Python suite exactly.

```
$ bunx tsc --noEmit
(no output, exit 0)
```

---

## Step 3: Agent port (Phase 2)

Ported `backend/agent/mcts_agent.py` → `frontend/src/lib/surge/engine/mctsAgent.ts`.
Live MCTS with UCB1 exploration, identical algorithm: selection via UCB
score until an unvisited node is reached, then a uniform-random rollout to
a terminal state, then backpropagation of the result along the visited
path. `updateFromTrajectory()` is ported too (same backup rule, usable for
folding a real game's result into the table without new rollouts).

**Deliberately has no `load()`/`save()`.** The Python original persists its
table to a pickle file on disk; this port starts with a completely empty
table and needs nothing precomputed to function — exactly the same
methodology as the original Python "blank table" agent benchmarked earlier
in this project (`scripts/benchmark_head_to_head.py`'s `EMPTY` sentinel
agent, which also started blank and only ever held in-memory state for the
duration of one benchmark run). A real persistence story for the extension
(most likely `chrome.storage.local`) is an open question, flagged below,
not decided here.

### Real benchmark: TypeScript agent vs random bot

Run with `bun run scripts/benchmarkEngineVsRandom.ts 300 100` (300 games,
100 simulations/move, blank table at start, methodology matching the
original Python agent-vs-random evaluation in
`scripts/benchmark_snapshots.py`'s `evaluate_snapshot`):

```
TypeScript MCTSAgent (blank table at start, 100 simulations/move) vs random bot: 300 games, sides alternated
  agent win rate: 0.9700 (291/300)
  elapsed: 15.5s (19.3 games/sec)
  final table size: 21593 state entries
```

**97% win rate against random**, with zero pretraining — consistent with
the original Python finding that live MCTS+UCB alone is a strong baseline
independent of any accumulated table. This is also a meaningful
correctness signal for the port itself: a rules-engine or agent bug would
much more likely show up as a win rate near 50% or erratic/illegal-feeling
play, not a clean 97%.

### Real raw compute time per move (explicitly NOT in-browser performance)

Run with `bun run scripts/measureMoveLatency.ts` — 10 trials per
simulation count, each trial a fresh blank-table agent against a fresh
game (first move only, so all four numbers are comparable):

```
Raw JS-engine compute time per move (Bun process, fresh blank-table agent + fresh game each trial):
NOT in-browser rendering performance -- see header comment.

   20 simulations: mean 5.98ms  (min 2.21ms, max 21.14ms, n=10)
   50 simulations: mean 6.91ms  (min 5.24ms, max 8.88ms, n=10)
  100 simulations: mean 12.37ms  (min 10.49ms, max 15.85ms, n=10)
  200 simulations: mean 25.36ms  (min 21.39ms, max 28.92ms, n=10)
```

**This is raw Bun-process compute time, not real in-browser performance.**
A real extension popup has React rendering competing for the main thread,
different GC behavior under browser memory pressure, and a different JS
engine (V8 in Chrome vs. Bun's JavaScriptCore-derived engine) -- these
numbers say "the algorithm itself is cheap at these simulation counts,"
nothing more. Real in-browser numbers need a human watching a real browser,
explicitly out of scope here.

---

## Open questions flagged for human review (not guessed at)

1. **Final difficulty-tier simulation counts for the extension are NOT
   decided here.** The numbers above are raw compute data for review, not
   a recommendation. Real in-browser testing with a human watching is
   required before picking Easy/Medium/Hard defaults for the extension —
   this explicitly was not done, per the brief.
2. **Persistence strategy is undecided.** The web app's agent persists a
   trained table to a pickle file; this ported agent has no equivalent
   yet. `chrome.storage.local` is the likely answer (mentioned in
   `extension/vite.config.ts`'s plan comment) but needs a deliberate design
   decision, not an assumption baked into the port.
3. **Whether the extension should ship with a pre-trained table at all**
   (mirroring the web app's 5000-game `mcts_policy.pkl`) or rely purely on
   live per-session search (as benchmarked above) is also undecided — that
   shapes whether a future phase needs a build step that serializes a
   trained TS table into the extension bundle.

---

## Explicitly not done in this round (per the brief)

- No wiring into `client.ts`.
- No UI work, no popup, no side panel.
- No `@crxjs/vite-plugin` installation or build wiring.
- No merge of `chrome-extension` into `master`.
- No final difficulty defaults picked.

Stopping here, as instructed.
