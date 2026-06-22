import { motion } from "framer-motion";
import type { Player } from "@/lib/surge/types";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

export type PieceAnim = "idle" | "standard" | "surge" | "exposed_capture" | "winner";

export function Piece({
  owner,
  row,
  col,
  fromRow,
  cell,
  exposed,
  anim,
  winner,
  initialOffsetY,
  staggerIndex,
}: {
  owner: Player;
  row: number;
  col: number;
  // Visual (post-flip) row this piece moved from, set only on the piece
  // that just played a Surge. Needed because the lift below must be
  // computed relative to the move's actual start and end, not just an
  // offset from the destination -- see the comment by `animateY`.
  fromRow?: number;
  cell: number;
  exposed: boolean;
  anim: PieceAnim;
  winner: boolean;
  initialOffsetY?: number;
  staggerIndex?: number;
}) {
  const reduced = usePrefersReducedMotion();
  const color = owner === "A" ? "var(--color-player-a)" : "var(--color-player-b)";

  const x = col * cell;
  const y = row * cell;

  // Spring configs
  const standardSpring = { type: "spring" as const, stiffness: 180, damping: 22 };
  // The surge arc animates y through 3 keyframes ([y, y - lift, y]); spring/inertia
  // transitions only support exactly 2 keyframes, so this must be a tween.
  const surgeTransition = { type: "tween" as const, duration: 0.32, ease: "easeInOut" as const };

  // Arc for surge: lift slightly mid-flight via keyframes on y. Framer
  // Motion treats this 3-element array as literal articulation points
  // (current visual position -> y -> dip -> y), so for the dip to be a
  // genuine extremum -- smaller than *both* the start and the end, not
  // just offset from one of them -- it must subtract the lift from
  // whichever of the two real endpoints is already smaller (closer to the
  // top of the screen). The old `y - lift` always used the destination
  // alone, which happened to be the smaller endpoint for every move A
  // plays (so it looked fine), but is the *larger* endpoint for every
  // Surge B plays after the board flip, landing the "dip" inside the
  // [from, to] range instead of below it -- a flat line, no visible arc.
  // (A first attempt at this fix used the midpoint of the two endpoints,
  // which is wrong too: it just relocates the same bug from B to A.)
  const dipBase = fromRow !== undefined ? Math.min(fromRow * cell, y) : y;
  const animateY = anim === "surge" && !reduced ? [y, dipBase - cell * 0.35, y] : y;

  return (
    <motion.div
      className="absolute"
      style={{
        width: cell,
        height: cell,
        left: 0,
        top: 0,
        pointerEvents: "none",
      }}
      initial={
        initialOffsetY !== undefined
          ? { x, y: y + initialOffsetY, opacity: 0 }
          : { x, y, opacity: 1 }
      }
      animate={{
        x,
        y: animateY,
        opacity: 1,
      }}
      transition={
        reduced
          ? { duration: 0 }
          : initialOffsetY !== undefined
            ? {
                type: "spring",
                stiffness: 220,
                damping: 24,
                delay: (staggerIndex ?? 0) * 0.03,
              }
            : anim === "surge"
              ? surgeTransition
              : standardSpring
      }
    >
      <PieceVisual color={color} exposed={exposed} winner={winner} anim={anim} reduced={reduced} cell={cell} />
    </motion.div>
  );
}

function PieceVisual({
  color,
  exposed,
  winner,
  anim,
  reduced,
  cell,
}: {
  color: string;
  exposed: boolean;
  winner: boolean;
  anim: PieceAnim;
  reduced: boolean;
  cell: number;
}) {
  const size = cell * 0.62;
  return (
    <div className="w-full h-full flex items-center justify-center">
      <motion.div
        className="rounded-full relative"
        style={{
          width: size,
          height: size,
          // color is a var(...) reference -- appending hex alpha suffixes
          // directly onto it (e.g. `${color}ee`) does not produce a valid
          // 8-digit hex color in CSS; var(--x)ee tokenizes as the variable
          // plus a stray separate ident, making the whole background
          // declaration invalid and the piece render with no fill at all.
          // color-mix() is the correct way to blend a var() with alpha.
          background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${color} 93%, transparent), color-mix(in srgb, ${color} 67%, transparent) 60%, color-mix(in srgb, ${color} 40%, transparent) 100%)`,
          boxShadow: winner
            ? "0 0 24px var(--color-victory), 0 0 8px var(--color-victory)"
            : exposed
              ? "0 0 16px var(--color-surge-charge), 0 0 4px var(--color-surge-charge)"
              : `0 2px 6px rgba(0,0,0,0.4), inset 0 -2px 4px rgba(0,0,0,0.25)`,
        }}
        animate={
          winner && !reduced
            ? { scale: [1, 1.08, 1] }
            : anim === "exposed_capture" && !reduced
              ? { scale: [1, 1.18, 1] }
              : { scale: 1 }
        }
        transition={
          winner
            ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" }
            : { duration: 0.28, ease: "easeOut" }
        }
      >
        {exposed && !reduced && (
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{
              boxShadow: "0 0 14px var(--color-surge-charge)",
              border: "1px solid var(--color-surge-charge)",
            }}
            animate={{ opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        {exposed && reduced && (
          <div
            className="absolute inset-0 rounded-full"
            style={{
              border: "1px solid var(--color-surge-charge)",
              boxShadow: "0 0 6px var(--color-surge-charge)",
            }}
          />
        )}
      </motion.div>
    </div>
  );
}