import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { GameState, Move, MoveType, Pos } from "@/lib/surge/types";
import { COLS, ROWS, isExposed, samePos } from "@/lib/surge/types";
import { Piece, type PieceAnim } from "./Piece";
import { SurgeTrail } from "./SurgeTrail";
import { MoveTypeBadge } from "./MoveTypeBadge";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

export type PieceRecord = {
  id: string;
  owner: "A" | "B";
  pos: Pos;
  anim: PieceAnim;
};

export function Board({
  state,
  pieces,
  capturedThisTurn,
  selectedFrom,
  onSelect,
  onCommit,
  disabled,
  surgeTrail,
  initialOrchestrated,
}: {
  state: GameState;
  pieces: PieceRecord[];
  capturedThisTurn: PieceRecord[];
  selectedFrom: Pos | null;
  onSelect: (pos: Pos | null) => void;
  onCommit: (move: Move) => void;
  disabled: boolean;
  surgeTrail: { from: Pos; to: Pos; key: number } | null;
  initialOrchestrated: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  const [cell, setCell] = useState(64);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<Pos>([0, 0]);
  const [hoverPos, setHoverPos] = useState<Pos | null>(null);

  useEffect(() => {
    function recompute() {
      if (typeof window === "undefined") return;
      const maxW = Math.min(window.innerWidth - 32, 420);
      const maxH = window.innerHeight - 220;
      const byW = Math.floor(maxW / COLS);
      const byH = Math.floor(maxH / ROWS);
      const c = Math.max(44, Math.min(72, Math.min(byW, byH)));
      setCell(c);
    }
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, []);

  // Visual orientation: B renders at the top, A at the bottom, so the
  // human's own pieces sit closest to them. board[0]=A / board[5]=B in the
  // underlying data never changes -- this is a pure display-coordinate
  // transform. It's its own inverse (a vertical mirror), so the same
  // function converts board-row -> visual-row and visual-row -> board-row.
  const flipRow = (r: number) => ROWS - 1 - r;

  const boardW = cell * COLS;
  const boardH = cell * ROWS;

  // Legal moves for currently selected piece
  const legalForSelected: Move[] = useMemo(() => {
    if (!selectedFrom) return [];
    return state.legal_moves.filter((m) => samePos(m.from_pos, selectedFrom));
  }, [state.legal_moves, selectedFrom]);

  // Map "r,c" -> Move for fast lookup of legal targets
  const targetMap = useMemo(() => {
    const m = new Map<string, Move>();
    for (const mv of legalForSelected) m.set(`${mv.to_pos[0]},${mv.to_pos[1]}`, mv);
    return m;
  }, [legalForSelected]);

  // Can-select set (own pieces with at least one legal move starting there)
  const canSelect = useMemo(() => {
    const s = new Set<string>();
    if (state.current_player !== "A" || state.winner) return s;
    for (const m of state.legal_moves) s.add(`${m.from_pos[0]},${m.from_pos[1]}`);
    return s;
  }, [state.legal_moves, state.current_player, state.winner]);

  function handleCellClick(r: number, c: number) {
    if (disabled) return;
    const key = `${r},${c}`;
    if (selectedFrom && targetMap.has(key)) {
      onCommit(targetMap.get(key)!);
      return;
    }
    if (canSelect.has(key)) {
      onSelect([r, c]);
      setFocus([r, c]);
      return;
    }
    onSelect(null);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (disabled) return;
    let [r, c] = focus;
    // B (high r) renders visually on top now, so ArrowUp moves toward
    // higher r and ArrowDown toward lower r -- the reverse of board-row order.
    if (e.key === "ArrowUp") r = Math.min(ROWS - 1, r + 1);
    else if (e.key === "ArrowDown") r = Math.max(0, r - 1);
    else if (e.key === "ArrowLeft") c = Math.max(0, c - 1);
    else if (e.key === "ArrowRight") c = Math.min(COLS - 1, c + 1);
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleCellClick(focus[0], focus[1]);
      return;
    } else if (e.key === "Escape") {
      onSelect(null);
      return;
    } else {
      return;
    }
    e.preventDefault();
    setFocus([r, c]);
    setHoverPos([r, c]);
  }

  const hoverMove: Move | null =
    hoverPos && selectedFrom ? targetMap.get(`${hoverPos[0]},${hoverPos[1]}`) ?? null : null;
  const hoverMoveType: MoveType | null = hoverMove ? hoverMove.move_type : null;

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        ref={wrapRef}
        tabIndex={0}
        onKeyDown={handleKey}
        className="relative outline-none rounded-md"
        style={{
          width: boardW,
          height: boardH,
          background: "var(--color-surface-panel)",
          boxShadow:
            "inset 0 0 0 1px rgba(255,255,255,0.04), 0 8px 30px rgba(0,0,0,0.45)",
          padding: 0,
          pointerEvents: disabled ? "none" : "auto",
          opacity: disabled ? 0.92 : 1,
          transition: "opacity 180ms ease",
        }}
        aria-label="Surge board, 5 columns by 6 rows"
        role="grid"
      >
        {/* Cell grid */}
        <div
          className="absolute inset-0 grid"
          style={{
            gridTemplateColumns: `repeat(${COLS}, ${cell}px)`,
            gridTemplateRows: `repeat(${ROWS}, ${cell}px)`,
          }}
        >
          {Array.from({ length: ROWS * COLS }).map((_, idx) => {
            // flipRow converts that visual slot to the real board row.
            const r = flipRow(Math.floor(idx / COLS));
            const c = idx % COLS;
            const key = `${r},${c}`;
            const isFocus = focus[0] === r && focus[1] === c;
            const isSelected = selectedFrom && samePos(selectedFrom, [r, c]);
            const target = targetMap.get(key);
            const isLightSquare = (r + c) % 2 === 0;
            return (
              <div
                key={key}
                role="gridcell"
                onClick={() => handleCellClick(r, c)}
                onMouseEnter={() => setHoverPos([r, c])}
                onMouseLeave={() => setHoverPos(null)}
                className="relative"
                style={{
                  background: isLightSquare
                    ? "rgba(255,255,255,0.018)"
                    : "rgba(0,0,0,0.12)",
                  cursor: target || canSelect.has(key) ? "pointer" : "default",
                }}
              >
                {/* focus ring */}
                {isFocus && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,0.35)",
                      borderRadius: 2,
                    }}
                  />
                )}
                {/* selected ring */}
                {isSelected && (
                  <div
                    className="absolute inset-1 pointer-events-none rounded-sm"
                    style={{
                      boxShadow: "inset 0 0 0 1.5px var(--color-player-a)",
                    }}
                  />
                )}
                {/* legal target highlight */}
                {target && (
                  <LegalTargetMark
                    moveType={target.move_type}
                    reduced={reduced}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Surge trail SVG overlay */}
        <svg
          className="absolute inset-0 pointer-events-none"
          width={boardW}
          height={boardH}
          viewBox={`0 0 ${boardW} ${boardH}`}
        >
          {surgeTrail && (
            <SurgeTrail
              key={surgeTrail.key}
              from={[flipRow(surgeTrail.from[0]), surgeTrail.from[1]]}
              to={[flipRow(surgeTrail.to[0]), surgeTrail.to[1]]}
              cell={cell}
              visible
            />
          )}
        </svg>

        {/* Pieces layer */}
        <div className="absolute inset-0 pointer-events-none">
          <AnimatePresence>
            {pieces.map((p, i) => (
              <Piece
                key={p.id}
                owner={p.owner}
                row={flipRow(p.pos[0])}
                col={p.pos[1]}
                cell={cell}
                exposed={isExposed(state, p.pos)}
                anim={p.anim}
                winner={state.winner === p.owner && state.winner !== null}
                initialOffsetY={initialOrchestrated ? -12 : undefined}
                staggerIndex={initialOrchestrated ? i : undefined}
              />
            ))}
          </AnimatePresence>
          {/* Captured pieces fading out */}
          <AnimatePresence>
            {capturedThisTurn.map((p) => (
              <CapturedFade key={`cap-${p.id}`} owner={p.owner} row={flipRow(p.pos[0])} col={p.pos[1]} cell={cell} />
            ))}
          </AnimatePresence>
        </div>
      </div>

      <div className="h-7 flex items-center" aria-live="polite">
        <MoveTypeBadge moveType={hoverMoveType} />
      </div>
    </div>
  );
}

function LegalTargetMark({ moveType, reduced }: { moveType: MoveType; reduced: boolean }) {
  const isSurge = moveType === "surge_move";
  const color = isSurge ? "var(--color-surge-charge)" : "var(--color-player-a)";
  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center pointer-events-none"
      initial={reduced ? { opacity: 1 } : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduced ? { duration: 0 } : { duration: 0.12 }}
    >
      <div
        className="rounded-full"
        style={{
          width: "24%",
          height: "24%",
          background: color,
          opacity: 0.55,
          boxShadow: isSurge ? "0 0 10px var(--color-surge-charge)" : "none",
        }}
      />
    </motion.div>
  );
}

function CapturedFade({
  owner,
  row,
  col,
  cell,
}: {
  owner: "A" | "B";
  row: number;
  col: number;
  cell: number;
}) {
  const reduced = usePrefersReducedMotion();
  const color = owner === "A" ? "var(--color-player-a)" : "var(--color-player-b)";
  const size = cell * 0.62;
  return (
    <motion.div
      className="absolute"
      style={{ width: cell, height: cell, left: col * cell, top: row * cell }}
      initial={{ opacity: 1, scale: 1 }}
      animate={{ opacity: 0, scale: 0.85 }}
      exit={{ opacity: 0 }}
      transition={reduced ? { duration: 0 } : { duration: 0.32, ease: "easeOut" }}
    >
      <div className="w-full h-full flex items-center justify-center">
        <div
          className="rounded-full"
          style={{
            width: size,
            height: size,
            // See Piece.tsx for why this can't be `${color}ee` etc. -- var()
            // doesn't accept a directly-appended alpha hex suffix.
            background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${color} 93%, transparent), color-mix(in srgb, ${color} 67%, transparent) 60%, color-mix(in srgb, ${color} 40%, transparent) 100%)`,
          }}
        />
      </div>
    </motion.div>
  );
}