import os
import random

from agent.mcts_agent import MCTSAgent, move_key
from rules_engine.game_state import GameState
from rules_engine.moves import apply_move, generate_legal_moves


def test_agent_only_picks_legal_moves():
    agent = MCTSAgent(policy_path="unused.pkl", n_simulations=20, rng=random.Random(1))
    state = GameState()
    legal = generate_legal_moves(state)
    legal_keys = {move_key(m) for m in legal}

    move = agent.search(state)
    assert move_key(move) in legal_keys


def test_agent_completes_a_full_self_play_game():
    agent = MCTSAgent(policy_path="unused.pkl", n_simulations=15, rng=random.Random(2))
    state = GameState()
    turns = 0
    while not state.is_over() and turns < 300:
        move = agent.search(state)
        state = apply_move(state, move)
        turns += 1

    assert state.is_over()
    assert state.winner in ("A", "B")
    assert len(agent.table) > 0


def test_policy_save_and_load_roundtrip(tmp_path):
    policy_path = str(tmp_path / "policy.pkl")
    agent = MCTSAgent(policy_path=policy_path, n_simulations=15, rng=random.Random(3))
    state = GameState()
    agent.search(state)
    assert len(agent.table) > 0
    agent.save()

    reloaded = MCTSAgent(policy_path=policy_path, n_simulations=15, rng=random.Random(3))
    assert reloaded.table.keys() == agent.table.keys()
    assert os.path.exists(policy_path)
