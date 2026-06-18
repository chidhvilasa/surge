"""Human vs human terminal interface for Surge. Built directly on the rules
engine with no AI involved -- this is the Milestone 2 correctness check."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rules_engine.board import PLAYER_A, PLAYER_B, opponent_of
from rules_engine.game_state import GameState
from rules_engine.moves import Move, apply_move, generate_legal_moves

MOVE_LABELS = {
    "standard_move": "move",
    "standard_capture": "capture",
    "surge_move": "SURGE move",
    "surge_capture": "SURGE capture",
    "exposed_capture": "EXPOSED capture",
}


def render(state: GameState) -> str:
    lines = [state.board.to_text()]
    lines.append(
        f"Turn {state.turn_number} | Current: {state.current_player} | "
        f"Surge tokens A={state.surge_tokens[PLAYER_A]} B={state.surge_tokens[PLAYER_B]}"
    )
    if state.exposed:
        lines.append(f"EXPOSED: {state.exposed.owner}'s piece at {state.exposed.pos}")
    return "\n".join(lines)


def list_moves(moves: list[Move]) -> str:
    lines = []
    for i, m in enumerate(moves):
        label = MOVE_LABELS[m.move_type]
        lines.append(f"  [{i}] {m.from_pos} -> {m.to_pos}  ({label})")
    return "\n".join(lines)


def main() -> None:
    print("=== SURGE: terminal human vs human ===")
    print("Board coordinates are (row, col), row 0-5, col 0-4.")
    print(f"Player A starts on row 0 and advances toward row 5.")
    print(f"Player B starts on row 5 and advances toward row 0.")
    print()

    state = GameState()

    while not state.is_over():
        print()
        print(render(state))
        legal = generate_legal_moves(state)
        if not legal:
            # Shouldn't happen: apply_move already detects this and ends
            # the game, but guard defensively for the very first turn.
            break
        print(f"\nLegal moves for {state.current_player}:")
        print(list_moves(legal))

        choice = input(f"\n{state.current_player}, pick a move index (or 'q' to quit): ").strip()
        if choice.lower() == "q":
            print("Game aborted.")
            return
        if not choice.isdigit() or not (0 <= int(choice) < len(legal)):
            print("Invalid selection, try again.")
            continue

        move = legal[int(choice)]
        state = apply_move(state, move)

    print()
    print(render(state))
    if state.winner:
        print(f"\n*** {state.winner} WINS by {state.win_reason} ***")


if __name__ == "__main__":
    main()
