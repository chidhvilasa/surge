from typing import Optional

from pydantic import BaseModel


class MoveOption(BaseModel):
    from_pos: tuple[int, int]
    to_pos: tuple[int, int]
    move_type: str


class ExposedOut(BaseModel):
    pos: tuple[int, int]
    owner: str


class GameStateOut(BaseModel):
    game_id: str
    board: list[list[Optional[str]]]
    current_player: str
    surge_tokens: dict[str, int]
    exposed: Optional[ExposedOut]
    winner: Optional[str]
    win_reason: Optional[str]
    turn_number: int
    legal_moves: list[MoveOption]


class MoveIn(BaseModel):
    from_pos: tuple[int, int]
    to_pos: tuple[int, int]
    move_type: Optional[str] = None


class AgentMoveOut(BaseModel):
    move_played: Optional[MoveOption]
    state: GameStateOut
