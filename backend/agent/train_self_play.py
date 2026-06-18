"""Milestone 4: self-play training loop for the MCTS agent.

The agent plays both sides against itself, updating one shared on-disk
table. Surge usage rate per game is tracked and logged as a proxy metric
for whether the agent is learning to take calculated risks (spending
Surge when the resulting Exposed window is safe) rather than just playing
defensively and never touching its tokens.
"""
import argparse
import csv
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agent.mcts_agent import DEFAULT_POLICY_PATH, MCTSAgent
from rules_engine.board import PLAYER_A, PLAYER_B
from rules_engine.game_state import GameState
from rules_engine.moves import apply_move

LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "policy_store", "training_log.csv")


def run_training(
    games: int,
    simulations: int,
    save_every: int,
    policy_path: str = DEFAULT_POLICY_PATH,
    log_path: str = LOG_PATH,
    max_turns: int = 300,
    verbose: bool = True,
) -> MCTSAgent:
    agent = MCTSAgent(policy_path=policy_path, n_simulations=simulations)

    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    write_header = not os.path.exists(log_path)
    log_file = open(log_path, "a", newline="")
    writer = csv.writer(log_file)
    if write_header:
        writer.writerow(["game", "winner", "reason", "turns", "surge_A", "surge_B", "surge_rate", "table_size"])

    recent_rates = []
    start = time.time()

    for game_idx in range(1, games + 1):
        state = GameState()
        surge_uses = {PLAYER_A: 0, PLAYER_B: 0}
        turns = 0

        while not state.is_over() and turns < max_turns:
            move = agent.search(state)
            if move.is_surge():
                surge_uses[move.player] += 1
            state = apply_move(state, move)
            turns += 1

        total_surge = surge_uses[PLAYER_A] + surge_uses[PLAYER_B]
        rate = total_surge / turns if turns else 0.0
        recent_rates.append(rate)

        writer.writerow(
            [game_idx, state.winner, state.win_reason, turns, surge_uses[PLAYER_A], surge_uses[PLAYER_B], f"{rate:.4f}", len(agent.table)]
        )

        if game_idx % save_every == 0 or game_idx == games:
            agent.save()
            log_file.flush()
            if verbose:
                avg_rate = sum(recent_rates) / len(recent_rates)
                elapsed = time.time() - start
                print(
                    f"[{game_idx}/{games}] elapsed={elapsed:.1f}s table_size={len(agent.table)} "
                    f"avg_surge_rate(last {len(recent_rates)})={avg_rate:.3f} "
                    f"last_winner={state.winner} reason={state.win_reason} turns={turns}"
                )
            recent_rates = []

    log_file.close()
    return agent


def main() -> None:
    parser = argparse.ArgumentParser(description="Self-play training for the Surge MCTS agent")
    parser.add_argument("--games", type=int, default=200)
    parser.add_argument("--simulations", type=int, default=100, help="MCTS simulations per move")
    parser.add_argument("--save-every", type=int, default=20)
    parser.add_argument("--policy-path", type=str, default=DEFAULT_POLICY_PATH)
    args = parser.parse_args()

    run_training(
        games=args.games,
        simulations=args.simulations,
        save_every=args.save_every,
        policy_path=args.policy_path,
    )


if __name__ == "__main__":
    main()
