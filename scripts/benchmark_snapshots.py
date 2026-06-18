"""Standalone benchmarking script: trains the MCTS agent through self-play,
takes a policy snapshot every N games, and evaluates each snapshot against
the random-move bot to produce a win-rate-over-training-progress curve.

This is deliberately separate from backend/agent/train_self_play.py (which
trains the one production policy used by the API) and from
scripts/benchmark_random_bots.py (which stress-tests the rules engine with
two random bots). Nothing here touches backend/agent/policy_store/
mcts_policy.pkl, backend/agent/policy_store/training_log.csv, or any API
code -- it trains its own agent from scratch into its own snapshot
directory.
"""
import argparse
import csv
import os
import random
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

from agent.mcts_agent import MCTSAgent
from rules_engine.board import PLAYER_A, PLAYER_B
from rules_engine.game_state import GameState
from rules_engine.moves import apply_move, generate_legal_moves

DEFAULT_SNAPSHOT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "backend", "agent", "policy_store", "benchmark_snapshots",
)
DEFAULT_OUTPUT_CSV = os.path.join(DEFAULT_SNAPSHOT_DIR, "win_rate_by_snapshot.csv")


def play_one_self_play_game(agent: MCTSAgent, max_turns: int) -> None:
    state = GameState()
    turns = 0
    while not state.is_over() and turns < max_turns:
        move = agent.search(state)
        state = apply_move(state, move)
        turns += 1


def play_agent_vs_random(agent: MCTSAgent, agent_player: str, rng: random.Random, max_turns: int) -> GameState:
    state = GameState()
    turns = 0
    while not state.is_over() and turns < max_turns:
        legal = generate_legal_moves(state)
        if not legal:
            break
        if state.current_player == agent_player:
            move = agent.search(state)
        else:
            move = rng.choice(legal)
        state = apply_move(state, move)
        turns += 1
    return state


def evaluate_snapshot(agent: MCTSAgent, eval_games: int, rng: random.Random, max_turns: int) -> float:
    wins = 0
    for i in range(eval_games):
        agent_player = PLAYER_A if i % 2 == 0 else PLAYER_B
        final_state = play_agent_vs_random(agent, agent_player, rng, max_turns)
        if final_state.winner == agent_player:
            wins += 1
    return wins / eval_games


def main() -> None:
    parser = argparse.ArgumentParser(description="Train via self-play, snapshot every N games, benchmark each snapshot vs a random bot")
    parser.add_argument("--total-games", type=int, default=2000, help="total self-play training games to run")
    parser.add_argument("--snapshot-every", type=int, default=500, help="take + evaluate a snapshot every this many self-play games")
    parser.add_argument("--eval-games", type=int, default=200, help="random-bot evaluation games per snapshot")
    parser.add_argument("--simulations", type=int, default=60, help="MCTS simulations per move, both training and evaluation")
    parser.add_argument("--max-turns", type=int, default=300)
    parser.add_argument("--seed", type=int, default=123)
    parser.add_argument("--snapshot-dir", type=str, default=DEFAULT_SNAPSHOT_DIR)
    parser.add_argument("--output-csv", type=str, default=DEFAULT_OUTPUT_CSV)
    args = parser.parse_args()

    os.makedirs(args.snapshot_dir, exist_ok=True)
    rng = random.Random(args.seed)

    agent_policy_path = os.path.join(args.snapshot_dir, "_in_progress.pkl")
    agent = MCTSAgent(policy_path=agent_policy_path, n_simulations=args.simulations)
    agent.table = {}  # always start this benchmark run from a blank table

    write_header = not os.path.exists(args.output_csv)
    csv_file = open(args.output_csv, "a", newline="")
    writer = csv.writer(csv_file)
    if write_header:
        writer.writerow(["snapshot_games", "win_rate_vs_random", "eval_games", "table_size"])

    games_done = 0
    start = time.time()
    while games_done < args.total_games:
        chunk_target = min(args.snapshot_every, args.total_games - games_done)
        for _ in range(chunk_target):
            play_one_self_play_game(agent, args.max_turns)
        games_done += chunk_target

        snapshot_path = os.path.join(args.snapshot_dir, f"snapshot_{games_done}.pkl")
        agent.policy_path = snapshot_path
        agent.save()

        win_rate = evaluate_snapshot(agent, args.eval_games, rng, args.max_turns)
        writer.writerow([games_done, f"{win_rate:.4f}", args.eval_games, len(agent.table)])
        csv_file.flush()

        elapsed = time.time() - start
        print(
            f"[snapshot {games_done}/{args.total_games}] elapsed={elapsed:.1f}s "
            f"win_rate_vs_random={win_rate:.3f} table_size={len(agent.table)}"
        )

    csv_file.close()
    if os.path.exists(agent_policy_path):
        os.remove(agent_policy_path)


if __name__ == "__main__":
    main()
