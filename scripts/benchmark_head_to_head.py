"""Standalone head-to-head benchmark: pits two policy snapshots (or a
freshly-constructed, untrained agent) directly against each other.

scripts/benchmark_snapshots.py answers "does the agent beat a random
bot." That's a low bar and saturates almost immediately. This script
answers a sharper question: does a later snapshot actually play better
MCTS than an earlier one (or than zero learned history at all), under
identical search budgets for both sides.

Never writes to the snapshot files it loads -- each agent's policy_path is
swapped to a throwaway value right after loading, so even an accidental
save() call can't touch the real snapshot.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

from agent.mcts_agent import MCTSAgent
from rules_engine.board import PLAYER_A, PLAYER_B
from rules_engine.game_state import GameState
from rules_engine.moves import apply_move

EMPTY_SENTINEL = "EMPTY"


def load_agent(policy_arg: str, simulations: int) -> MCTSAgent:
    if policy_arg == EMPTY_SENTINEL:
        agent = MCTSAgent(policy_path="_unused.pkl", n_simulations=simulations)
        agent.table = {}
    else:
        agent = MCTSAgent(policy_path=policy_arg, n_simulations=simulations)
    agent.policy_path = "_head_to_head_never_saved.pkl"
    return agent


def play_one_game(agent_a: MCTSAgent, agent_b: MCTSAgent, agent_a_side: str, max_turns: int) -> str | None:
    """agent_a controls `agent_a_side`, agent_b controls the other side.
    Returns "a", "b", or None if max_turns was hit with no winner."""
    agent_b_side = PLAYER_B if agent_a_side == PLAYER_A else PLAYER_A
    side_of_agent = {agent_a_side: agent_a, agent_b_side: agent_b}

    state = GameState()
    turns = 0
    while not state.is_over() and turns < max_turns:
        mover = side_of_agent[state.current_player]
        move = mover.search(state)
        state = apply_move(state, move)
        turns += 1

    if state.winner is None:
        return None
    return "a" if side_of_agent[state.winner] is agent_a else "b"


def run_head_to_head(
    policy_a: str, policy_b: str, games: int, simulations: int, max_turns: int, label_a: str, label_b: str
) -> tuple[float, float]:
    agent_a = load_agent(policy_a, simulations)
    agent_b = load_agent(policy_b, simulations)

    wins_a = wins_b = undecided = 0
    for i in range(games):
        agent_a_side = PLAYER_A if i % 2 == 0 else PLAYER_B
        result = play_one_game(agent_a, agent_b, agent_a_side, max_turns)
        if result == "a":
            wins_a += 1
        elif result == "b":
            wins_b += 1
        else:
            undecided += 1

    print(f"{label_a} vs {label_b}: {games} games, {simulations} simulations/move each, sides alternated")
    print(f"  {label_a} win rate: {wins_a / games:.4f} ({wins_a}/{games})")
    print(f"  {label_b} win rate: {wins_b / games:.4f} ({wins_b}/{games})")
    if undecided:
        print(f"  undecided (hit max_turns with no winner): {undecided}")

    return wins_a / games, wins_b / games


def main() -> None:
    parser = argparse.ArgumentParser(description="Head-to-head benchmark between two MCTS policy snapshots")
    parser.add_argument("--policy-a", type=str, required=True, help=f"path to a snapshot .pkl, or '{EMPTY_SENTINEL}' for a blank-table agent")
    parser.add_argument("--policy-b", type=str, required=True, help=f"path to a snapshot .pkl, or '{EMPTY_SENTINEL}' for a blank-table agent")
    parser.add_argument("--label-a", type=str, default=None)
    parser.add_argument("--label-b", type=str, default=None)
    parser.add_argument("--games", type=int, default=200)
    parser.add_argument("--simulations", type=int, default=200)
    parser.add_argument("--max-turns", type=int, default=300)
    args = parser.parse_args()

    label_a = args.label_a or args.policy_a
    label_b = args.label_b or args.policy_b

    run_head_to_head(args.policy_a, args.policy_b, args.games, args.simulations, args.max_turns, label_a, label_b)


if __name__ == "__main__":
    main()
