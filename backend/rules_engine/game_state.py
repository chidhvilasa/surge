"""Game state: board + Surge tokens + Exposed status + whose turn it is."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .board import Board, PLAYER_A, PLAYER_B, opponent_of

STARTING_SURGE_TOKENS = 3


@dataclass(frozen=True)
class Exposed:
    """An Exposed piece: position, owner, and the position it surged from."""

    pos: tuple[int, int]
    owner: str


class GameState:
    """Full state of a Surge game. Treated as immutable: apply_move returns
    a new GameState rather than mutating this one."""

    def __init__(
        self,
        board: Optional[Board] = None,
        current_player: str = PLAYER_A,
        surge_tokens: Optional[dict[str, int]] = None,
        exposed: Optional[Exposed] = None,
        winner: Optional[str] = None,
        win_reason: Optional[str] = None,
        turn_number: int = 1,
        history: Optional[list[tuple]] = None,
    ):
        self.board = board if board is not None else Board.initial()
        self.current_player = current_player
        self.surge_tokens = (
            dict(surge_tokens)
            if surge_tokens is not None
            else {PLAYER_A: STARTING_SURGE_TOKENS, PLAYER_B: STARTING_SURGE_TOKENS}
        )
        self.exposed = exposed
        self.winner = winner
        self.win_reason = win_reason
        self.turn_number = turn_number
        # Real trajectory of (state_key_before_move, action_key, player) for
        # every move actually applied to reach this state. action_key is
        # (from_pos, to_pos, move_type), matching agent.mcts_agent.move_key.
        self.history: list[tuple] = list(history) if history is not None else []

    def clone(self) -> "GameState":
        return GameState(
            board=self.board.clone(),
            current_player=self.current_player,
            surge_tokens=dict(self.surge_tokens),
            exposed=self.exposed,
            winner=self.winner,
            win_reason=self.win_reason,
            turn_number=self.turn_number,
            history=self.history,
        )

    def is_over(self) -> bool:
        return self.winner is not None

    def state_key(self) -> tuple:
        """Canonical, hashable representation used for MCTS/Q-table lookups."""
        board_tuple = tuple(tuple(row) for row in self.board.grid)
        exposed_key = (self.exposed.pos, self.exposed.owner) if self.exposed else None
        return (
            board_tuple,
            self.current_player,
            self.surge_tokens[PLAYER_A],
            self.surge_tokens[PLAYER_B],
            exposed_key,
        )

    def __repr__(self) -> str:
        return f"GameState(turn={self.turn_number}, current={self.current_player}, winner={self.winner})"
