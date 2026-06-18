
# Surge — Implementation Plan (revised: `exposed` is a single nullable object)

A 2-player turn-based strategy game on a 5-column × 6-row grid. UI built entirely against a mock data module, with a single swappable API client so a real backend can be wired in later by changing one file.

**Player roles:** A is always the human, B is always the agent. Documented as a comment in `SurgeGame.tsx` and `mock.ts`.

**Design thesis:** Surge is a scarce, electric gamble. Everything quiet and disciplined except the three Surge moments — the charge, the glow, the flash. Restraint is the point.

---

## Visual identity (unchanged)

### Color tokens (defined in `src/styles.css` under `@theme`)

| Token            | Hex       | Purpose                                                                 |
| ---------------- | --------- | ----------------------------------------------------------------------- |
| `--color-bg-field`      | `#1B1E26` | Page background. Cool graphite-slate.                                    |
| `--color-surface-panel` | `#242832` | Inset board surface and slim readout strip.                              |
| `--color-player-a`      | `#D98E4A` | Player A pieces and accents (warm copper).                               |
| `--color-player-b`      | `#3FA9A0` | Player B pieces and accents (cool teal).                                 |
| `--color-surge-charge`  | `#B14EFF` | **Exclusively** for Surge moments: charge trail, Exposed glow, Exposed-capture flash, token-spend pip flicker. |
| `--color-victory`       | `#F2C572` | Win banner and winning-piece highlight only.                             |

### Typography
- `IBM Plex Mono` — display/data: turn counter, token counts, coordinates.
- `Inter Tight` — body/UI: labels, buttons, win banner headline.

### Layout
Board centered as the stage. Single slim **tactical readout strip** along top: turn, A's tokens, B's tokens, "Agent thinking…" slot. Token counts render as three discrete monospaced pips per player so a spend has something specific to animate. No cards, no sidebars.

---

## Motion spec (unchanged)

Framer Motion springs for all piece movement.

| Moment | Motion |
|---|---|
| First load | Orchestrated staggered settle (~30ms). |
| Standard move | Spring 180/22, no overshoot. |
| Standard capture | Brief squash on attacker + quiet `scale 0.85 → 0` fade on victim. |
| Legal move highlight | Quiet 120ms fade-in ring. |
| **Surge — charge** | `surge-charge` current animates `pathLength` along jump path, ahead of piece. |
| **Surge — arc** | Spring 340/16, slight overshoot. Visible y-lift arc over jumped square. |
| **Surge — exposed glow** | Persistent `surge-charge` halo on landed piece for entire Exposed window. |
| **Exposed capture** | Sharp `surge-charge` burst + brighten, victim fades. |
| **Surge token spent** | Single affected pip does ~250ms `surge-charge` flicker, then settles dim. |
| Win sequence | Winning piece pulses with `--color-victory`, board dims, banner scales in. |

No idle ambient animation. No particles, confetti, or screen shake. `prefers-reduced-motion` collapses everything to instant state changes (Exposed glow → static ring, charge trail → static dashed line that appears/disappears, spent pip → instant dim). Full keyboard play: arrow keys move focus, Enter selects/commits, Escape clears. Responsive to ~360px.

---

## Architecture

```text
src/
  lib/surge/
    types.ts          # GameState, Move, Cell, Pos, Player, MoveType, Exposed
    mock.ts           # In-memory mock backend (rules, agent, artificial latency)
    client.ts         # Public API — single swap point (USE_MOCK / API_BASE_URL)
    normalize.ts      # extractState(response, endpointType) -> flat GameState
    index.ts          # isExposed(state, pos) helper
  components/surge/
    SurgeGame.tsx     # Top-level state container
    Board.tsx         # 6×5 grid, keyboard nav, selection + dispatch
    Cell.tsx          # Square: highlights, focus ring, drop target
    Piece.tsx         # Animated piece (slide / arc / capture / exposed glow)
    SurgeTrail.tsx    # Charge current along a surge jump path
    Readout.tsx       # Top strip: turn, pips (with spend flicker), thinking slot
    MoveTypeBadge.tsx # Hover/focus label: Standard / Surge / Exposed capture
    WinBanner.tsx     # Animated win overlay
  routes/index.tsx    # Mounts <SurgeGame />
```

`Readout.tsx` diffs `surge_tokens` against the previous state to fire the pip flicker on the pip that just turned off.

---

## **Data shape — CORRECTED**

Confirmed against the real backend:
- Each board cell is a bare value: `"A" | "B" | null`. **Not** an object.
- `exposed` is a **single nullable object** at the top level of `GameState`: `{ pos: [r, c], owner: "A" | "B" } | null`. There is at most one exposed piece at any time. **Not** an array, **not** per-cell.

### Types (`src/lib/surge/types.ts`)

```ts
export type Player = "A" | "B";
export type Cell = Player | null;            // bare value, not an object
export type Board = Cell[][];                // 6 rows × 5 cols; row 0 = A's back, row 5 = B's back
export type Pos = [number, number];          // [row, col]
export type MoveType = "standard_move" | "surge_move" | "exposed_capture";

export type Move = {
  from_pos: Pos;
  to_pos: Pos;
  move_type: MoveType;
};

export type Exposed = { pos: Pos; owner: Player } | null;  // single object, not an array

export type GameState = {
  game_id: string;
  board: Board;
  current_player: Player;
  surge_tokens: { A: number; B: number };
  exposed: Exposed;                          // ← single nullable object
  legal_moves: Move[];
  winner: Player | null;
  win_reason?: "breakthrough" | "elimination" | "stalemate";  // UNVERIFIED — see note
};
```

### Helper (`src/lib/surge/index.ts`)

```ts
export function isExposed(state: GameState, pos: Pos): boolean {
  return state.exposed !== null
    && state.exposed.pos[0] === pos[0]
    && state.exposed.pos[1] === pos[1];
}
```

### Component reads (Board.tsx, Piece.tsx, Cell.tsx)

- Cell occupancy: `const owner = board[r][c];` then `if (owner === "A") ...`. Never `.occupied_by`.
- Exposed check: `isExposed(state, [r, c])` — or pass `exposed: boolean` as a prop computed in `Board`.
- `Piece` receives `owner: Player` and `exposed: boolean` as props.

### Mock (`src/lib/surge/mock.ts`)

- Initial board built as `Cell[][]` with bare values: row 0 filled with `"A"`, row 5 filled with `"B"`, everything else `null`.
- Top-level `exposed: Exposed` tracked as a single value, initialized to `null`.
- After a successful `surge_move`: set `exposed = { pos: destination, owner: mover }`.
- At the **start** of each player's turn: if `exposed !== null && exposed.owner === currentPlayer`, reset `exposed = null`.
- `exposed_capture` legal-move generation: if `state.exposed !== null`, read its `pos` and `owner`, scan the 8 surrounding cells, and for each enemy of `owner` emit `{ from_pos: enemy, to_pos: exposed.pos, move_type: "exposed_capture" }`. No token cost. Any direction allowed for the capturer.
- All cell comparisons use bare values (`board[r][c] === "A"`), never `.occupied_by`.

### Normalize (`src/lib/surge/normalize.ts`)

- Pass `board`, `exposed`, `surge_tokens`, `current_player`, `legal_moves`, `winner`, `win_reason` straight through without transformation.
- `exposed` is passed through as-is (object or null). No array conversion.
- No legacy adapter for object-cell shape — both real backend and mock return bare values.
- `agent-move` shape: `{ move_played, state }` → `{ movePlayed, state }`.

---

## Mock backend — rules (unchanged)

**Starting setup:** A on row 0 cols 0–4, B on row 5 cols 0–4. `surge_tokens: { A: 3, B: 3 }`. `exposed: null`. `current_player: "A"`.

**Forward direction:** A toward row 5 (`dr = +1`). B toward row 0 (`dr = -1`).

**Standard moves** (one step forward only):
- Forward-straight: legal only into empty cell. Never a capture.
- Forward-diagonal: empty (move) or enemy-occupied (capture).
- No sideways, no backward.

**Surge moves** (two squares straight forward, jumping middle):
- Requires destination on-board and `surge_tokens[mover] > 0`.
- Middle square is ignored entirely.
- Destination must be empty or enemy-occupied (not own piece).
- Consumes 1 Surge token. Sets `exposed = { pos: destination, owner: mover }` until the start of mover's next turn.

**Exposed-capture** (first-class entries in `legal_moves`):
- If `state.exposed` is non-null, scan 8 surrounding cells of `exposed.pos`; for each enemy of `exposed.owner`, emit `{ from_pos: enemy, to_pos: exposed.pos, move_type: "exposed_capture" }`. No token cost.

**Win conditions:**
1. Breakthrough: A reaches row 5, or B reaches row 0.
2. Elimination: opponent has zero pieces.
3. Stalemate-as-loss: player to move has no legal moves → opponent wins.

**Agent (player B):** Random pick from `legal_moves`. `requestAgentMove` waits 400–800ms.

---

## UI behavior (unchanged)

- Click/keyboard-select own piece → selected; legal destinations fade in.
- Hover/focus a target → `MoveTypeBadge` shows Standard / Surge / Exposed capture. Surge target is the only highlight using `surge-charge`.
- Commit → `submitMove` → animate response (standard slide, or full surge sequence: trail → arc → settle with glow, with pip flicker fired in parallel from `Readout`'s diff).
- After A moves and game not over: enter agent-thinking state (readout caret pulse, board pointer events disabled, selection cleared), call `requestAgentMove`, animate `movePlayed`, re-enable.
- Win banner appears when `winner !== null` with a "New game" action.

### State flow in `SurgeGame`
```text
useState : gameState, selectedFrom, focusCursor, lastMove, isAgentThinking
useEffect: mount → createGame()
useEffect: current_player === "B" && !winner && !isAgentThinking → thinking, requestAgentMove, animate, clear
handlers : selectPiece(pos), submitMove(to, moveType)   // blocked while thinking
derived  : legalTargetsForSelected = legal_moves.filter(m => from_pos == selected)
```

No legal-move or win logic ever computed in components — they read `legal_moves`, `exposed`, and `winner` from state.

---

## Open verification note

`win_reason` values (`"breakthrough" | "elimination" | "stalemate"`) have not yet been confirmed against a real finished game — no game in testing has ended. Typed as-is for now; revisit once a real win occurs and the actual field value can be observed. No code change for this pending verification.

---

## Out of scope
Real backend wiring (only swap point prepared), routing, auth, persistence, sound, multiplayer networking, human-vs-human mode, particles, confetti, idle ambient animation.

## Deliverable check
Replace `src/routes/index.tsx` placeholder with `<SurgeGame />`. Verify in preview: bare-value cell reads work end-to-end, single-object `exposed` correctly drives the glow + exposed-capture entries, orchestrated load, standard moves with calm spring, diagonal captures, full Surge sequence with pip flicker, agent-thinking state with 400–800ms lock, breakthrough triggers gold win banner, reduced-motion collapses everything to instant, keyboard play works, layout holds at 360px.
