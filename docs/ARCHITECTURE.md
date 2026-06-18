# Surge — Architecture

## Layout

```
backend/
  rules_engine/   Pure game logic. No I/O, no randomness, no AI. Deterministic
                   given a state and a move.
  agent/           MCTS self-play agent + training loop + saved policy.
  api/             FastAPI app wrapping rules_engine + agent for the frontend.
  cli/             Terminal human-vs-human interface built directly on the
                   rules engine, used as the milestone-1/2 correctness check.
  tests/           pytest suite covering rules_engine and agent.
scripts/           Standalone entry points: training driver, random-bot
                   stress benchmark.
frontend/          Generated separately (Lovable) then owned in-repo. See
                   Milestone 6 in the project brief.
```

## Design choices

- **Rules engine is the single source of truth.** Both the CLI, the random
  bots, the MCTS agent, and the API all call into
  `backend/rules_engine` rather than re-implementing any rule. This is what
  lets the random-bot stress test (Milestone 3) actually validate the engine
  used everywhere else.
- **GameState is immutable-by-convention.** `GameState.apply_move()` returns
  a new `GameState` (via `clone()` + mutation of the clone) rather than
  mutating in place. This makes MCTS tree search straightforward (no need to
  undo moves) at a modest memory cost acceptable for a 30-cell board.
- **No external services anywhere in the decision path.** The agent is a
  local MCTS implementation with UCB1 exploration; its only inputs are the
  current `GameState` and its on-disk policy/statistics file. The optional
  Ollama flavor-text feature (if built) is strictly cosmetic and is never
  consulted when selecting a move.
- **Policy persistence.** The MCTS agent persists aggregated visit/value
  statistics keyed by a canonical state hash to
  `backend/agent/policy_store/`, reloaded on startup so training improvement
  survives across processes.
