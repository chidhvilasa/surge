"""FastAPI layer wrapping the rules engine and the trained MCTS agent.
Runs entirely on localhost; no external services are involved."""
import csv
import os
import sys
import uuid

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from agent.mcts_agent import MCTSAgent
from api.schemas import AgentMoveOut, ExposedOut, GameStateOut, MoveIn, MoveOption
from rules_engine.game_state import GameState
from rules_engine.moves import apply_move, generate_legal_moves

app = FastAPI(title="Surge API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080"],
    allow_methods=["*"],
    allow_headers=["*"],
)

games: dict[str, GameState] = {}
agent = MCTSAgent(n_simulations=int(os.environ.get("SURGE_AGENT_SIMULATIONS", "200")))

# Counts real human-vs-agent games folded into the policy, kept separate
# from the self-play game counter in agent/train_self_play.py's log, so a
# strange benchmark result can be traced to one source or the other.
HUMAN_UPDATE_LOG_PATH = os.path.join(BACKEND_DIR, "agent", "policy_store", "human_game_updates.csv")
human_update_count = 0

# game_ids whose finished trajectory has already been folded into the
# policy, so a repeat call (e.g. a retried request landing after the game
# was already recorded) can't backpropagate the same game twice.
recorded_games: set[str] = set()


def record_finished_game(game_id: str, state: GameState) -> None:
    """If `state` is a just-finished game that hasn't been recorded yet,
    fold its real trajectory into the agent's table using the same backup
    rule as self-play training, persist the updated policy, and log the
    update."""
    global human_update_count
    if not state.is_over() or not state.history:
        return
    if game_id in recorded_games:
        return
    recorded_games.add(game_id)

    agent.update_from_trajectory(state.history, state.winner)
    agent.save()

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
    )


def get_game(game_id: str) -> GameState:
    state = games.get(game_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Game not found")
    return state


@app.post("/games", response_model=GameStateOut)
def start_game() -> GameStateOut:
    game_id = str(uuid.uuid4())
    state = GameState()
    games[game_id] = state
    return to_state_out(game_id, state)


@app.get("/games/{game_id}", response_model=GameStateOut)
def get_game_state(game_id: str) -> GameStateOut:
    state = get_game(game_id)
    return to_state_out(game_id, state)


@app.post("/games/{game_id}/move", response_model=GameStateOut)
def submit_move(game_id: str, move_in: MoveIn) -> GameStateOut:
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
    record_finished_game(game_id, new_state)
    return to_state_out(game_id, new_state)


@app.post("/games/{game_id}/agent-move", response_model=AgentMoveOut)
def agent_move(game_id: str) -> AgentMoveOut:
    state = get_game(game_id)
    if state.is_over():
        raise HTTPException(status_code=400, detail="Game is already over")

    move = agent.search(state)
    new_state = apply_move(state, move)
    games[game_id] = new_state
    record_finished_game(game_id, new_state)

    move_out = MoveOption(from_pos=move.from_pos, to_pos=move.to_pos, move_type=move.move_type)
    return AgentMoveOut(move_played=move_out, state=to_state_out(game_id, new_state))
