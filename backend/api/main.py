"""FastAPI layer wrapping the rules engine and the trained MCTS agent.
Runs entirely on localhost; no external services are involved."""
import csv
import json
import os
import sys
import threading
import time
import uuid
from datetime import datetime, timezone

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from agent.mcts_agent import MCTSAgent
from api.schemas import AgentMoveOut, ExposedOut, GameStateOut, MoveIn, MoveOption, StartGameIn
from rules_engine.game_state import GameState
from rules_engine.moves import Move, apply_move, generate_legal_moves

app = FastAPI(title="Surge API")

# localhost:8080 (the dev server) always allowed; SURGE_CORS_ORIGINS adds
# the real production frontend origin(s) once known, comma-separated, e.g.
# "https://surge.example.com,https://www.surge.example.com" -- no code
# change needed to point this at wherever the frontend actually deploys.
_extra_origins = [
    o.strip() for o in os.environ.get("SURGE_CORS_ORIGINS", "").split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", *_extra_origins],
    allow_methods=["*"],
    allow_headers=["*"],
)

games: dict[str, GameState] = {}

# "hard" reuses this exact instance (not a copy) so existing tests that
# monkeypatch agent.n_simulations / agent.policy_path keep working
# unchanged -- "hard" is also the default difficulty for a new game.
# lazy=True: see the lazy-load cache below this block. Constructing this
# object is cheap either way (just config attributes); lazy=True only
# defers the actual pickle load, so monkeypatching agent.n_simulations
# before first use still works exactly as before.
agent = MCTSAgent(n_simulations=int(os.environ.get("SURGE_AGENT_SIMULATIONS", "200")), lazy=True)

# First attempt at difficulty tiers was three simulation-count budgets
# (15/60/200) all searching the SAME 5000-game table. Real head-to-head
# benchmarking (see scripts/h2h_easy_vs_medium.log) found easy(15) and
# medium(60) tied exactly 50/50 -- with a table this saturated (2.28M
# entries from 5000 self-play games), the table itself carries most of the
# skill, so varying simulation count on top of an identical table barely
# moved the needle. Simulation count was the wrong lever.
#
# What's already proven to produce a real gap (scripts/h2h_5000_vs_500.log,
# earlier in this project): snapshot_5000 beat snapshot_500 80.5% of the
# time, and beat a blank table 89% of the time. So each tier now loads its
# OWN less-trained snapshot as a genuinely separate table, not a shared one.
#
# These two snapshot files are PRODUCTION ASSETS now, not disposable
# benchmark output -- despite living next to mcts_policy.pkl's naming
# pattern, they must not be deleted as benchmark scratch. See README.
EASY_POLICY_PATH = os.path.join(BACKEND_DIR, "agent", "policy_store", "easy_policy.pkl")
MEDIUM_POLICY_PATH = os.path.join(BACKEND_DIR, "agent", "policy_store", "medium_policy.pkl")

for _name, _path in (("easy", EASY_POLICY_PATH), ("medium", MEDIUM_POLICY_PATH)):
    if not os.path.exists(_path):
        raise RuntimeError(
            f"Missing required policy snapshot for difficulty '{_name}': {_path}. "
            "This is a production asset, not a disposable benchmark artifact. "
            "Regenerate via scripts/benchmark_snapshots.py and copy the matching "
            "snapshot into backend/agent/policy_store/ under this exact name -- see README."
        )

# Starting points, re-benchmarked on this exact snapshot+simulation
# combination (see scripts/h2h_*.log) before trusting the labels -- a
# different combination (same table, different sim counts) was tried first
# and rejected above for not actually differentiating.
difficulty_agents: dict[str, MCTSAgent] = {
    "easy": MCTSAgent(policy_path=EASY_POLICY_PATH, n_simulations=30, lazy=True),
    "medium": MCTSAgent(policy_path=MEDIUM_POLICY_PATH, n_simulations=80, lazy=True),
    "hard": agent,
}

# Lazy-load-per-tier cache: at most one tier's table resident at a time.
# Measured real RSS with all three loaded simultaneously was ~8.6GB
# (2.28M + 1.02M + 0.22M states; pickle deserialization + Python's
# per-object overhead inflates this ~11x over the ~744MB combined file
# size on disk) -- far beyond a "reasonable" hosting tier, so eagerly
# loading all three at startup is not viable for deployment. Switching
# tiers evicts the previously-active one: its table is handed off to a
# background thread to persist (a real measured save of the hard tier's
# table takes ~32s, far too long to make the request that triggered the
# switch wait on it) before being dropped, using the same save_lock as
# the normal finished-game save path so the two can never race on the
# same file. This is a single-tenant-style tradeoff: concurrent games on
# different tiers will thrash (reload on every switch) rather than all
# staying resident -- acceptable for this app's actual traffic, revisit
# if that ever changes.
_active_tier: str | None = None
_tier_cache_lock = threading.Lock()


def _evict_tier_in_background(tier_agent: MCTSAgent, table: dict) -> None:
    t0 = time.time()
    with save_lock:
        tier_agent.save(table=table)
    print(
        f"[timing] tier eviction save ({tier_agent.policy_path}) completed in {time.time() - t0:.3f}s "
        f"(table_size={len(table)})",
        flush=True,
    )


def get_tier_agent(difficulty: str) -> MCTSAgent:
    global _active_tier
    with _tier_cache_lock:
        if difficulty == _active_tier:
            return difficulty_agents[difficulty]
        if _active_tier is not None:
            previous = difficulty_agents[_active_tier]
            dropped_table = previous.unload()
            if dropped_table:
                threading.Thread(
                    target=_evict_tier_in_background,
                    args=(previous, dropped_table),
                    daemon=True,
                ).start()
        tier_agent = difficulty_agents[difficulty]
        tier_agent.ensure_loaded()
        _active_tier = difficulty
        return tier_agent

# Per-game difficulty, set once at creation and used for every search call
# made for that specific game -- a per-game parameter, not a global server
# setting. Kept as API-layer bookkeeping alongside `games` rather than on
# GameState itself, since the rules engine has no concept of "agent" at all.
game_difficulty: dict[str, str] = {}

# Counts real human-vs-agent games folded into the policy, kept separate
# from the self-play game counter in agent/train_self_play.py's log, so a
# strange benchmark result can be traced to one source or the other.
HUMAN_UPDATE_LOG_PATH = os.path.join(BACKEND_DIR, "agent", "policy_store", "human_game_updates.csv")
human_update_count = 0

# game_ids whose finished trajectory has already been folded into the
# policy, so a repeat call (e.g. a retried request landing after the game
# was already recorded) can't backpropagate the same game twice.
recorded_games: set[str] = set()

# Serializes every tier's save() calls (one shared lock across all three --
# simpler than a per-tier lock, and concurrent saves on the same local
# single-user app are rare enough that the extra serialization cost is
# negligible). Without this, two games finishing close together could both
# pickle a table concurrently, and whichever os.replace() lands second (not
# necessarily the one with the most recent table state) would win, silently
# discarding the other game's update.
save_lock = threading.Lock()

# Append-only move log, separate from the training/human-update CSVs above
# so it's never confused with those. A plain file append is microseconds,
# nowhere near the cost of the policy pickle write -- no background task
# needed here, just a lock so concurrent requests can't interleave lines.
MOVE_LOG_PATH = os.path.join(BACKEND_DIR, "logs", "move_log.jsonl")
move_log_lock = threading.Lock()


def log_move(game_id: str, move: Move, state: GameState) -> None:
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "game_id": game_id,
        "player": move.player,
        "move_type": move.move_type,
        "from_pos": list(move.from_pos),
        "to_pos": list(move.to_pos),
        "board_after": state.board.grid,
        "winner": state.winner,
        "win_reason": state.win_reason,
    }
    with move_log_lock:
        os.makedirs(os.path.dirname(MOVE_LOG_PATH), exist_ok=True)
        with open(MOVE_LOG_PATH, "a") as f:
            f.write(json.dumps(entry) + "\n")


def _save_policy_in_background(tier_agent: MCTSAgent) -> None:
    # Snapshot the table's key-set *before* anything else in this task,
    # per snapshot_table()'s own brief lock -- not while holding save_lock,
    # and not interleaved with the slow pickle below. Without this,
    # pickle.dump() iterating the *live* table directly while a concurrent
    # request's search() was still adding newly-discovered states raised a
    # real production RuntimeError ("dictionary changed size during
    # iteration"). save_lock now only serializes the write itself (still
    # needed: two finished games' saves racing on os.replace() could
    # otherwise let the one with stale data land last and win).
    t0 = time.time()
    snapshot = tier_agent.snapshot_table()
    table_size = len(snapshot)
    with save_lock:
        tier_agent.save(table=snapshot)
    print(
        f"[timing] background save ({tier_agent.policy_path}) completed in {time.time() - t0:.3f}s "
        f"(table_size at save time={table_size})",
        flush=True,
    )


def record_finished_game(game_id: str, state: GameState, background_tasks: BackgroundTasks) -> None:
    """If `state` is a just-finished game that hasn't been recorded yet,
    fold its real trajectory into the agent's table using the same backup
    rule as self-play training, log the update, and schedule the (slow)
    disk save to run after the HTTP response has already been sent --
    table size is currently large enough that synchronous pickling adds
    tens of seconds the player would otherwise sit and wait through."""
    global human_update_count
    if not state.is_over() or not state.history:
        return
    if game_id in recorded_games:
        return
    recorded_games.add(game_id)

    tier_agent = get_tier_agent(game_difficulty.get(game_id, "hard"))
    t0 = time.time()
    tier_agent.update_from_trajectory(state.history, state.winner)
    t1 = time.time()
    print(
        f"[timing] record_finished_game: update_from_trajectory={t1 - t0:.3f}s "
        f"(save deferred to background task)",
        flush=True,
    )
    background_tasks.add_task(_save_policy_in_background, tier_agent)

    human_update_count += 1
    os.makedirs(os.path.dirname(HUMAN_UPDATE_LOG_PATH), exist_ok=True)
    write_header = not os.path.exists(HUMAN_UPDATE_LOG_PATH)
    with open(HUMAN_UPDATE_LOG_PATH, "a", newline="") as f:
        writer = csv.writer(f)
        if write_header:
            writer.writerow(["update_number", "winner", "win_reason", "moves"])
        writer.writerow([human_update_count, state.winner, state.win_reason, len(state.history)])


def to_state_out(game_id: str, state: GameState) -> GameStateOut:
    legal = generate_legal_moves(state) if not state.is_over() else []
    return GameStateOut(
        game_id=game_id,
        board=state.board.grid,
        current_player=state.current_player,
        surge_tokens=state.surge_tokens,
        exposed=ExposedOut(pos=state.exposed.pos, owner=state.exposed.owner) if state.exposed else None,
        winner=state.winner,
        win_reason=state.win_reason,
        turn_number=state.turn_number,
        legal_moves=[MoveOption(from_pos=m.from_pos, to_pos=m.to_pos, move_type=m.move_type) for m in legal],
        difficulty=game_difficulty.get(game_id, "hard"),
    )


def get_game(game_id: str) -> GameState:
    state = games.get(game_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Game not found")
    return state


@app.post("/games", response_model=GameStateOut)
def start_game(body: StartGameIn = StartGameIn()) -> GameStateOut:
    game_id = str(uuid.uuid4())
    state = GameState()
    games[game_id] = state
    game_difficulty[game_id] = body.difficulty
    return to_state_out(game_id, state)


@app.get("/games/{game_id}", response_model=GameStateOut)
def get_game_state(game_id: str) -> GameStateOut:
    state = get_game(game_id)
    return to_state_out(game_id, state)


@app.post("/games/{game_id}/move", response_model=GameStateOut)
def submit_move(game_id: str, move_in: MoveIn, background_tasks: BackgroundTasks) -> GameStateOut:
    t_start = time.time()
    state = get_game(game_id)
    if state.is_over():
        raise HTTPException(status_code=400, detail="Game is already over")

    legal = generate_legal_moves(state)
    candidates = [
        m for m in legal
        if m.from_pos == tuple(move_in.from_pos) and m.to_pos == tuple(move_in.to_pos)
        and (move_in.move_type is None or m.move_type == move_in.move_type)
    ]
    if not candidates:
        raise HTTPException(status_code=400, detail="Illegal move")

    new_state = apply_move(state, candidates[0])
    games[game_id] = new_state
    log_move(game_id, candidates[0], new_state)
    record_finished_game(game_id, new_state, background_tasks)
    result = to_state_out(game_id, new_state)
    print(
        f"[timing] submit_move total request duration={time.time() - t_start:.3f}s "
        f"(winner={new_state.winner})",
        flush=True,
    )
    return result


@app.post("/games/{game_id}/agent-move", response_model=AgentMoveOut)
def agent_move(game_id: str, background_tasks: BackgroundTasks) -> AgentMoveOut:
    t_start = time.time()
    state = get_game(game_id)
    if state.is_over():
        raise HTTPException(status_code=400, detail="Game is already over")

    tier_agent = get_tier_agent(game_difficulty.get(game_id, "hard"))
    t_search0 = time.time()
    move = tier_agent.search(state)
    t_search1 = time.time()
    new_state = apply_move(state, move)
    t_apply1 = time.time()
    games[game_id] = new_state
    log_move(game_id, move, new_state)
    t_log1 = time.time()
    record_finished_game(game_id, new_state, background_tasks)
    t_record1 = time.time()
    print(
        f"[timing] agent_move breakdown: search={t_search1 - t_search0:.3f}s "
        f"apply_move={t_apply1 - t_search1:.3f}s log_move={t_log1 - t_apply1:.3f}s "
        f"record_finished_game={t_record1 - t_log1:.3f}s",
        flush=True,
    )

    move_out = MoveOption(from_pos=move.from_pos, to_pos=move.to_pos, move_type=move.move_type)
    result = AgentMoveOut(move_played=move_out, state=to_state_out(game_id, new_state))
    print(
        f"[timing] agent_move total request duration={time.time() - t_start:.3f}s "
        f"(winner={new_state.winner})",
        flush=True,
    )
    return result
