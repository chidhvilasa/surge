"""Legal move generation and move application for Surge."""
from __future__ import annotations

from dataclasses import dataclass

from .board import BACK_ROW, COLS, FORWARD, ROWS, opponent_of
from .game_state import Exposed, GameState

STANDARD_MOVE = "standard_move"
STANDARD_CAPTURE = "standard_capture"
SURGE_MOVE = "surge_move"
SURGE_CAPTURE = "surge_capture"
EXPOSED_CAPTURE = "exposed_capture"

CAPTURE_TYPES = {STANDARD_CAPTURE, SURGE_CAPTURE, EXPOSED_CAPTURE}
SURGE_TYPES = {SURGE_MOVE, SURGE_CAPTURE}


@dataclass(frozen=True)
class Move:
    from_pos: tuple[int, int]
    to_pos: tuple[int, int]
    move_type: str
    player: str

    def is_capture(self) -> bool:
        return self.move_type in CAPTURE_TYPES

    def is_surge(self) -> bool:
        return self.move_type in SURGE_TYPES


def _standard_destinations(row: int, col: int, player: str) -> list[tuple[int, int]]:
    d = FORWARD[player]
    return [(row + d, col), (row + d, col - 1), (row + d, col + 1)]


def generate_piece_standard_moves(state: GameState, pos: tuple[int, int]) -> list[Move]:
    row, col = pos
    player = state.board.get(row, col)
    if player is None:
        return []
    board = state.board
    d = FORWARD[player]
    moves: list[Move] = []

    straight = (row + d, col)
    if board.in_bounds(*straight) and board.is_empty(*straight):
        moves.append(Move(pos, straight, STANDARD_MOVE, player))

    for dest in ((row + d, col - 1), (row + d, col + 1)):
        if not board.in_bounds(*dest):
            continue
        occupant = board.get(*dest)
        if occupant is None:
            moves.append(Move(pos, dest, STANDARD_MOVE, player))
        elif occupant != player:
            moves.append(Move(pos, dest, STANDARD_CAPTURE, player))

    return moves


def generate_piece_surge_moves(state: GameState, pos: tuple[int, int]) -> list[Move]:
    row, col = pos
    player = state.board.get(row, col)
    if player is None or state.surge_tokens[player] <= 0:
        return []
    board = state.board
    d = FORWARD[player]
    dest = (row + 2 * d, col)
    if not board.in_bounds(*dest):
        return []
    occupant = board.get(*dest)
    if occupant == player:
        return []
    move_type = SURGE_CAPTURE if occupant is not None else SURGE_MOVE
    return [Move(pos, dest, move_type, player)]


def _exposed_capture_moves(state: GameState, player: str, existing: set[tuple]) -> list[Move]:
    exposed = state.exposed
    if exposed is None or exposed.owner == player:
        return []
    board = state.board
    er, ec = exposed.pos
    moves: list[Move] = []
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr == 0 and dc == 0:
                continue
            r, c = er + dr, ec + dc
            if not board.in_bounds(r, c):
                continue
            if board.get(r, c) != player:
                continue
            key = ((r, c), exposed.pos)
            if key in existing:
                continue
            moves.append(Move((r, c), exposed.pos, EXPOSED_CAPTURE, player))
    return moves


def generate_legal_moves(state: GameState, player: str | None = None) -> list[Move]:
    """All legal moves for `player` (default: state.current_player)."""
    if player is None:
        player = state.current_player

    moves: list[Move] = []
    seen: set[tuple] = set()
    for pos in list(state.board.pieces_of(player)):
        for mv in generate_piece_standard_moves(state, pos):
            moves.append(mv)
            seen.add((mv.from_pos, mv.to_pos))
        for mv in generate_piece_surge_moves(state, pos):
            moves.append(mv)
            seen.add((mv.from_pos, mv.to_pos))

    moves.extend(_exposed_capture_moves(state, player, seen))
    return moves


def apply_move(state: GameState, move: Move, validate: bool = True) -> GameState:
    """Return a new GameState with `move` applied. Raises ValueError if the
    move is not legal in `state` and `validate` is True (the default).

    `validate=False` is for hot-path callers (e.g. MCTS simulation) that
    already drew `move` from this exact state's own generate_legal_moves()
    result and so don't need it re-derived and re-checked a second time.
    Any caller handling external input (the API, the CLI) must keep the
    default."""
    if move.player != state.current_player:
        raise ValueError("Move player does not match current_player")

    if validate:
        legal = generate_legal_moves(state, move.player)
        if not any(
            m.from_pos == move.from_pos and m.to_pos == move.to_pos and m.move_type == move.move_type
            for m in legal
        ):
            raise ValueError(f"Illegal move: {move}")

    new_state = state.clone()
    board = new_state.board
    player = move.player
    opponent = opponent_of(player)

    new_state.history.append((state.state_key(), (move.from_pos, move.to_pos, move.move_type), player))

    if move.is_capture():
        if new_state.exposed is not None and new_state.exposed.pos == move.to_pos:
            new_state.exposed = None

    board.set(*move.from_pos, None)
    board.set(*move.to_pos, player)

    if move.is_surge():
        new_state.surge_tokens[player] -= 1
        new_state.exposed = Exposed(pos=move.to_pos, owner=player)

    if move.to_pos[0] == BACK_ROW[opponent]:
        new_state.winner = player
        new_state.win_reason = "back_row"
    elif board.count(opponent) == 0:
        new_state.winner = player
        new_state.win_reason = "elimination"

    new_state.current_player = opponent
    new_state.turn_number += 1

    if new_state.exposed is not None and new_state.exposed.owner == new_state.current_player:
        new_state.exposed = None

    if new_state.winner is None:
        if not generate_legal_moves(new_state, new_state.current_player):
            new_state.winner = player
            new_state.win_reason = "no_legal_moves"

    return new_state
