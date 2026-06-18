# Surge

A 5x6 board strategy game with a self-improving AI opponent: a local Monte
Carlo Tree Search (UCB1) agent trained entirely through self-play, with no
external API calls or hosted services involved in any decision.

Full rules: [docs/SURGE_GAME_SPEC.md](docs/SURGE_GAME_SPEC.md)
Architecture notes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Setup

```bash
python -m venv .venv
source .venv/Scripts/activate   # Windows Git Bash; use .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
```

## Run the tests

```bash
python -m pytest backend/tests/ -v
```

## Play in the terminal (human vs human)

```bash
python backend/cli/play_terminal.py
```

## Stress-test the rules engine (random bot vs random bot)

```bash
python scripts/benchmark_random_bots.py --games 20000
```

## Train the MCTS agent

```bash
python backend/agent/train_self_play.py --games 200 --simulations 100
```

Policy is saved to `backend/agent/policy_store/mcts_policy.pkl` and reloaded
automatically on the next run, so skill accumulates across sessions.
Surge usage rate per game is logged to
`backend/agent/policy_store/training_log.csv` as a proxy metric for whether
the agent is learning to take calculated risks rather than playing purely
defensively.

`mcts_policy.pkl` is a regenerable build artifact, not checked into git (it's
large and machine-specific). To regenerate it from scratch:

```bash
python backend/agent/train_self_play.py --games 5000 --simulations 200 --save-every 500
```

## Run the API

```bash
cd backend
python -m uvicorn api.main:app --reload --port 8000
```

Endpoints:

- `POST /games` — start a new game
- `GET /games/{game_id}` — fetch current board state
- `POST /games/{game_id}/move` — submit a human move (`from_pos`, `to_pos`, optional `move_type`)
- `POST /games/{game_id}/agent-move` — get the agent's response move

## Frontend

`frontend/` is populated separately: generate the visual layer with Lovable
(React, Tailwind, shadcn), pull the generated code into `frontend/`, and run
it locally with its own dev server, calling the FastAPI backend above on
`localhost:8000`. The Lovable project is a one-time generator, not a
live-synced dependency.

This Lovable export is a Bun project (`bun.lock`, `bunfig.toml`), not npm:

```bash
cd frontend
bun install
bun run dev
```
