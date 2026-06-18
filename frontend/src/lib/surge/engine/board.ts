// Ported 1:1 from backend/rules_engine/board.py.
// Board representation for Surge: a 5 column x 6 row grid.

export const ROWS = 6;
export const COLS = 5;

export type Player = "A" | "B";
export type Cell = Player | null;

export const PLAYER_A: Player = "A";
export const PLAYER_B: Player = "B";

// Forward direction (row delta) for each player.
export const FORWARD: Record<Player, number> = { A: 1, B: -1 };

// Each player's back row (their own start row, and the row the opponent
// must reach to win).
export const BACK_ROW: Record<Player, number> = { A: 0, B: ROWS - 1 };

export function opponentOf(player: Player): Player {
  return player === PLAYER_A ? PLAYER_B : PLAYER_A;
}

// Mutable grid of cells. Each cell holds null, PLAYER_A, or PLAYER_B.
export class Board {
  grid: Cell[][];

  constructor(grid?: Cell[][]) {
    this.grid = grid ?? Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null));
  }

  static initial(): Board {
    const board = new Board();
    for (let col = 0; col < COLS; col++) {
      board.grid[BACK_ROW[PLAYER_A]][col] = PLAYER_A;
      board.grid[BACK_ROW[PLAYER_B]][col] = PLAYER_B;
    }
    return board;
  }

  static inBounds(row: number, col: number): boolean {
    return row >= 0 && row < ROWS && col >= 0 && col < COLS;
  }

  get(row: number, col: number): Cell {
    return this.grid[row][col];
  }

  set(row: number, col: number, value: Cell): void {
    this.grid[row][col] = value;
  }

  isEmpty(row: number, col: number): boolean {
    return this.grid[row][col] === null;
  }

  *piecesOf(player: Player): Generator<[number, number]> {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (this.grid[row][col] === player) yield [row, col];
      }
    }
  }

  count(player: Player): number {
    let n = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _pos of this.piecesOf(player)) n++;
    return n;
  }

  clone(): Board {
    return new Board(this.grid.map((row) => row.slice()));
  }

  toText(): string {
    const symbols: Record<string, string> = { A: "A", B: "B" };
    const lines: string[] = [];
    for (let row = ROWS - 1; row >= 0; row--) {
      const cells = Array.from({ length: COLS }, (_, col) => {
        const v = this.grid[row][col];
        return v === null ? "." : symbols[v];
      }).join(" ");
      lines.push(`${row} | ${cells}`);
    }
    lines.push("    " + Array.from({ length: COLS }, (_, c) => String(c)).join(" "));
    return lines.join("\n");
  }

  // Python's Board defines __eq__; TS has no operator overloading, so this
  // is an explicit method instead -- the one structural difference from
  // a literal line-for-line port, documented here rather than silently.
  equals(other: Board): boolean {
    if (this.grid.length !== other.grid.length) return false;
    for (let r = 0; r < this.grid.length; r++) {
      if (this.grid[r].length !== other.grid[r].length) return false;
      for (let c = 0; c < this.grid[r].length; c++) {
        if (this.grid[r][c] !== other.grid[r][c]) return false;
      }
    }
    return true;
  }
}
