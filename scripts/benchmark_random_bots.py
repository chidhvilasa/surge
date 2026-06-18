"""Milestone 3: stress-test the rules engine with thousands of random-move
games. Random vs random is deliberately dumb -- it's designed to wander
into edge cases (Surge usage, Exposed windows, near-trapped positions) that
careful human play wouldn't reach. Any crash, illegal state, or
non-terminating game is logged as a failure.
"""
import argparse
import os
import random
import sys
import time
import traceback
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backend"))

from rules_engine.board import PLAYER_A, PLAYER_B
from rules_engine.game_state import GameState
from rules_engine.moves import generate_legal_moves, apply_move

# The spec guarantees termination (strictly forward movement, piece count
# never increases). 5x6 with 5 pieces a side bounds this comfortably; if a
# game blows past this many turns it indicates an engine bug, not a slow
# but valid game.
MAX_TURNS = 500


def play_one_game(rng: random.Random) -> dict:
    state = GameState()
    turns = 0
    surge_uses = {PLAYER_A: 0, PLAYER_B: 0}

    while not state.is_over():
        if turns >= MAX_TURNS:
            return {"status": "non_terminating", "turns": turns}

        legal = generate_legal_moves(state)
        if not legal:
            return {
                "status": "illegal_state",
                "turns": turns,
                "detail": f"current_player {state.current_player} has no moves but state.winner is None",
            }

        move = rng.choice(legal)
        if move.is_surge():
            surge_uses[move.player] += 1

        before_a = state.board.count(PLAYER_A)
        before_b = state.board.count(PLAYER_B)
        state = apply_move(state, move)
        after_a = state.board.count(PLAYER_A)
        after_b = state.board.count(PLAYER_B)

        if after_a > before_a or after_b > before_b:
            return {"status": "illegal_state", "turns": turns, "detail": "piece count increased"}

        turns += 1

    return {
        "status": "completed",
        "turns": turns,
        "winner": state.winner,
        "reason": state.win_reason,
        "surge_uses": surge_uses,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Random-bot vs random-bot stress test")
    parser.add_argument("--games", type=int, default=5000)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    results = Counter()
    win_reasons = Counter()
    winners = Counter()
    total_turns = 0
    failures = []
    surge_totals = {PLAYER_A: 0, PLAYER_B: 0}

    start = time.time()
    for game_idx in range(args.games):
        try:
            result = play_one_game(rng)
        except Exception:
            results["crashed"] += 1
            failures.append((game_idx, "crashed", traceback.format_exc()))
            continue

        results[result["status"]] += 1
        if result["status"] == "completed":
            total_turns += result["turns"]
            winners[result["winner"]] += 1
            win_reasons[result["reason"]] += 1
            for p in (PLAYER_A, PLAYER_B):
                surge_totals[p] += result["surge_uses"][p]
        else:
            failures.append((game_idx, result["status"], result))

    elapsed = time.time() - start

    print(f"Ran {args.games} games in {elapsed:.2f}s ({args.games / elapsed:.0f} games/sec)")
    print(f"Results: {dict(results)}")
    completed = results["completed"]
    if completed:
        print(f"Average turns per completed game: {total_turns / completed:.1f}")
        print(f"Winners: {dict(winners)}")
        print(f"Win reasons: {dict(win_reasons)}")
        print(
            f"Average Surge uses per game: A={surge_totals[PLAYER_A] / completed:.2f} "
            f"B={surge_totals[PLAYER_B] / completed:.2f}"
        )

    if failures:
        print(f"\n{len(failures)} FAILURES (showing up to 5):")
        for game_idx, status, detail in failures[:5]:
            print(f"  game {game_idx}: {status}: {detail}")
        sys.exit(1)
    else:
        print("\nNo crashes, illegal states, or non-terminating games detected.")


if __name__ == "__main__":
    main()
