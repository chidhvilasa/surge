"""Win condition inspection. Win/elimination/back-row checks are applied as
part of moves.apply_move(); this module exposes a read-only view of that
result plus a standalone helper for checking the no-legal-moves condition."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .game_state import GameState
from .moves import generate_legal_moves


@dataclass(frozen=True)
class WinResult:
    winner: str
    reason: str  # "back_row" | "elimination" | "no_legal_moves"


def check_winner(state: GameState) -> Optional[WinResult]:
    if state.winner is None:
        return None
    return WinResult(winner=state.winner, reason=state.win_reason or "")


def has_no_legal_moves(state: GameState, player: str | None = None) -> bool:
    player = player or state.current_player
    return len(generate_legal_moves(state, player)) == 0
