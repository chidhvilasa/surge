"""Board representation for Surge: a 5 column x 6 row grid."""
from __future__ import annotations

from typing import Iterator, Optional

ROWS = 6
COLS = 5

PLAYER_A = "A"
PLAYER_B = "B"

# Forward direction (row delta) for each player.
FORWARD = {PLAYER_A: 1, PLAYER_B: -1}

# Each player's back row (their own start row, and the row the opponent
# must reach to win).
BACK_ROW = {PLAYER_A: 0, PLAYER_B: ROWS - 1}


def opponent_of(player: str) -> str:
    return PLAYER_B if player == PLAYER_A else PLAYER_A


class Board:
    """Mutable grid of cells. Each cell holds None, PLAYER_A, or PLAYER_B."""

    __slots__ = ("grid",)

    def __init__(self, grid: Optional[list[list[Optional[str]]]] = None):
        if grid is not None:
            self.grid = grid
        else:
            self.grid = [[None for _ in range(COLS)] for _ in range(ROWS)]

    @classmethod
    def initial(cls) -> "Board":
        board = cls()
        for col in range(COLS):
            board.grid[BACK_ROW[PLAYER_A]][col] = PLAYER_A
            board.grid[BACK_ROW[PLAYER_B]][col] = PLAYER_B
        return board

    @staticmethod
    def in_bounds(row: int, col: int) -> bool:
        return 0 <= row < ROWS and 0 <= col < COLS

    def get(self, row: int, col: int) -> Optional[str]:
        return self.grid[row][col]

    def set(self, row: int, col: int, value: Optional[str]) -> None:
        self.grid[row][col] = value

    def is_empty(self, row: int, col: int) -> bool:
        return self.grid[row][col] is None

    def pieces_of(self, player: str) -> Iterator[tuple[int, int]]:
        for row in range(ROWS):
            for col in range(COLS):
                if self.grid[row][col] == player:
                    yield (row, col)

    def count(self, player: str) -> int:
        return sum(1 for _ in self.pieces_of(player))

    def clone(self) -> "Board":
        return Board([row[:] for row in self.grid])

    def to_text(self) -> str:
        symbols = {PLAYER_A: "A", PLAYER_B: "B", None: "."}
        lines = []
        for row in range(ROWS - 1, -1, -1):
            cells = " ".join(symbols[self.grid[row][col]] for col in range(COLS))
            lines.append(f"{row} | {cells}")
        lines.append("    " + " ".join(str(c) for c in range(COLS)))
        return "\n".join(lines)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, Board) and self.grid == other.grid
