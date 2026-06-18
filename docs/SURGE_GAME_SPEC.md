# Surge — Game Specification

## Board

- Grid: 5 columns x 6 rows (30 cells). Columns indexed 0-4, rows indexed 0-5.
- Player A starts with 5 pieces filling row 0 (their back row), one per column.
- Player B starts with 5 pieces filling row 5 (their back row), one per column.
- Player A advances toward row 5. Player B advances toward row 0.

## Standard movement

- A piece moves one step forward: straight (same column, +1 row toward the
  player's forward direction) or diagonally forward (column +-1, one row
  forward).
- Standard move (straight or diagonal) onto an **empty** square is legal.
- Standard **capture**: diagonal forward move onto a square occupied by an
  enemy piece. Straight-forward moves never capture.
- A square occupied by the mover's own piece blocks any standard move onto
  it.
- Pieces never move backward or sideways under standard rules.

## Surge

- Each player has exactly 3 Surge tokens for the entire game. No refills.
- Maximum one Surge usage per player per turn.
- A Surge move sends a piece two squares straight forward (same column,
  +-2 rows in the player's forward direction).
- The intermediate square (one step forward) is ignored entirely — its
  contents (empty, friendly, or enemy) have no effect and nothing happens to
  whatever occupies it.
- The destination square (two steps forward) must be empty (move) or
  enemy-occupied (capture). If the destination holds the mover's own piece,
  the Surge move is illegal.
- The surged piece becomes **Exposed** immediately.

## Exposed status

- A piece that just performed a Surge move is marked Exposed.
- Exposed lasts until the start of its owner's next turn — i.e. it is
  exploitable for exactly one opposing turn (the turn immediately following
  the Surge).
- While Exposed, any single opposing piece occupying one of the 8 cells
  surrounding the Exposed piece may capture it by moving directly into its
  square — including directions normally illegal for that piece (sideways,
  backward). This costs the opponent no Surge token and is a one-time
  exception to standard movement rules for that single move.
- If no opposing piece is adjacent, or the opponent does not take the
  capture, the Exposed status simply expires with no further effect once the
  owner's next turn begins.

## Win conditions

A player wins immediately when any of the following occurs:

1. One of their pieces reaches the opponent's back row (row 5 for Player A,
   row 0 for Player B).
2. All enemy pieces have been eliminated.
3. The opponent has zero legal moves available at the start of the
   opponent's turn (instant loss, no pass is allowed).

The game is guaranteed to terminate: movement is strictly forward (rows
never decrease for A / never increase for B) and piece count never
increases, so there is no draw-by-repetition case.

## State representation (for the rules engine and the RL agent)

- Board: 6x5 grid of cell contents (empty / Player A piece / Player B
  piece).
- Surge tokens remaining for Player A and Player B (0-3 each).
- Exposed status: which piece (if any) is currently Exposed, and which
  player's upcoming turn will clear it.
- Whose turn it currently is.
