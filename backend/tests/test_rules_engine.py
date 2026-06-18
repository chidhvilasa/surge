import pytest

from rules_engine.board import Board, PLAYER_A, PLAYER_B
from rules_engine.game_state import Exposed, GameState
from rules_engine.moves import (
    EXPOSED_CAPTURE,
    STANDARD_CAPTURE,
    STANDARD_MOVE,
    SURGE_CAPTURE,
    SURGE_MOVE,
    Move,
    apply_move,
    generate_legal_moves,
)
from rules_engine.win_conditions import has_no_legal_moves


def empty_state(**kwargs) -> GameState:
    return GameState(board=Board(), **kwargs)


def test_normal_capture():
    state = empty_state(current_player=PLAYER_A)
    state.board.set(2, 2, PLAYER_A)
    state.board.set(3, 3, PLAYER_B)

    move = Move((2, 2), (3, 3), STANDARD_CAPTURE, PLAYER_A)
    new_state = apply_move(state, move)

    assert new_state.board.get(3, 3) == PLAYER_A
    assert new_state.board.get(2, 2) is None
    assert new_state.board.count(PLAYER_B) == 0
    # Elimination of the only enemy piece is itself a win.
    assert new_state.winner == PLAYER_A
    assert new_state.win_reason == "elimination"


def test_illegal_own_piece_blocking():
    state = empty_state(current_player=PLAYER_A)
    state.board.set(2, 2, PLAYER_A)
    state.board.set(3, 2, PLAYER_A)  # blocks the straight-forward square

    legal = generate_legal_moves(state, PLAYER_A)
    blocked_targets = [m.to_pos for m in legal if m.from_pos == (2, 2)]
    assert (3, 2) not in blocked_targets

    illegal_move = Move((2, 2), (3, 2), STANDARD_MOVE, PLAYER_A)
    with pytest.raises(ValueError):
        apply_move(state, illegal_move)


def test_surge_jump_over_occupied_intermediate():
    state = empty_state(current_player=PLAYER_A)
    state.board.set(1, 2, PLAYER_A)
    state.board.set(2, 2, PLAYER_B)  # occupied intermediate square, must be ignored
    # destination (3, 2) left empty

    legal = generate_legal_moves(state, PLAYER_A)
    surge_moves = [m for m in legal if m.move_type == SURGE_MOVE and m.from_pos == (1, 2)]
    assert len(surge_moves) == 1
    assert surge_moves[0].to_pos == (3, 2)

    new_state = apply_move(state, surge_moves[0])

    # The intermediate square's occupant is untouched, not captured.
    assert new_state.board.get(2, 2) == PLAYER_B
    assert new_state.board.get(1, 2) is None
    assert new_state.board.get(3, 2) == PLAYER_A
    assert new_state.surge_tokens[PLAYER_A] == 2
    assert new_state.exposed == Exposed(pos=(3, 2), owner=PLAYER_A)


def test_exposed_capture_from_sideways_and_backward_directions():
    # Sideways capture: B's exposed piece sits beside an A piece on the same row.
    state = empty_state(current_player=PLAYER_A)
    state.board.set(3, 2, PLAYER_A)
    state.board.set(3, 3, PLAYER_B)
    state.exposed = Exposed(pos=(3, 3), owner=PLAYER_B)

    legal = generate_legal_moves(state, PLAYER_A)
    exposed_moves = [m for m in legal if m.move_type == EXPOSED_CAPTURE]
    assert any(m.from_pos == (3, 2) and m.to_pos == (3, 3) for m in exposed_moves)

    # A sideways move is illegal under standard rules for either player.
    standard_targets = [m.to_pos for m in generate_legal_moves(state, PLAYER_A) if m.move_type == STANDARD_MOVE or m.move_type == STANDARD_CAPTURE]
    assert (3, 3) not in [t for t in standard_targets if t == (3, 3)] or True  # sanity, see explicit check below
    assert not any(m.from_pos == (3, 2) and m.to_pos == (3, 3) and m.move_type in (STANDARD_MOVE, STANDARD_CAPTURE) for m in legal)

    new_state = apply_move(state, Move((3, 2), (3, 3), EXPOSED_CAPTURE, PLAYER_A))
    assert new_state.board.get(3, 3) == PLAYER_A
    assert new_state.board.get(3, 2) is None
    assert new_state.exposed is None

    # Backward capture: A's exposed piece sits one row "behind" a B piece
    # relative to B's forward direction (B moves toward decreasing rows).
    state2 = empty_state(current_player=PLAYER_B)
    state2.board.set(4, 3, PLAYER_B)
    state2.board.set(3, 3, PLAYER_A)
    state2.exposed = Exposed(pos=(3, 3), owner=PLAYER_A)

    legal2 = generate_legal_moves(state2, PLAYER_B)
    assert any(
        m.from_pos == (4, 3) and m.to_pos == (3, 3) and m.move_type == EXPOSED_CAPTURE
        for m in legal2
    )

    new_state2 = apply_move(state2, Move((4, 3), (3, 3), EXPOSED_CAPTURE, PLAYER_B))
    assert new_state2.board.get(3, 3) == PLAYER_B
    assert new_state2.exposed is None


def test_one_surge_per_turn_limit():
    state = empty_state(current_player=PLAYER_A, surge_tokens={PLAYER_A: 3, PLAYER_B: 3})
    state.board.set(1, 0, PLAYER_A)
    state.board.set(1, 4, PLAYER_A)

    surge_move = Move((1, 0), (3, 0), SURGE_MOVE, PLAYER_A)
    new_state = apply_move(state, surge_move)

    # Exactly one token spent.
    assert new_state.surge_tokens[PLAYER_A] == 2
    # Turn has passed to the opponent, so A structurally cannot spend a
    # second Surge token within the same turn.
    assert new_state.current_player == PLAYER_B

    second_surge = Move((1, 4), (3, 4), SURGE_MOVE, PLAYER_A)
    with pytest.raises(ValueError):
        apply_move(new_state, second_surge)

    # Once tokens are exhausted, no further Surge moves are generated.
    depleted = empty_state(current_player=PLAYER_A, surge_tokens={PLAYER_A: 0, PLAYER_B: 3})
    depleted.board.set(1, 0, PLAYER_A)
    legal = generate_legal_moves(depleted, PLAYER_A)
    assert not any(m.move_type in (SURGE_MOVE, SURGE_CAPTURE) for m in legal)


def test_no_legal_moves_loss_condition():
    state = empty_state(current_player=PLAYER_A, surge_tokens={PLAYER_A: 3, PLAYER_B: 0})

    for col in range(5):
        state.board.set(0, col, PLAYER_B)
    state.board.set(1, 1, PLAYER_B)
    state.board.set(1, 2, PLAYER_B)
    state.board.set(1, 3, PLAYER_B)
    state.board.set(2, 2, PLAYER_B)
    state.board.set(3, 0, PLAYER_A)

    assert has_no_legal_moves(state, PLAYER_B)

    move = Move((3, 0), (4, 0), STANDARD_MOVE, PLAYER_A)
    new_state = apply_move(state, move)

    assert new_state.current_player == PLAYER_B
    assert new_state.winner == PLAYER_A
    assert new_state.win_reason == "no_legal_moves"
