import { motion } from "framer-motion";
import type { Pos } from "@/lib/surge/types";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

// Renders a charge current along a straight 2-square surge jump.
// Coordinates are in cell units; consumer multiplies by CELL externally via
// the SVG viewBox.
export function SurgeTrail({
  from,
  to,
  cell,
  visible,
}: {
  from: Pos;
  to: Pos;
  cell: number;
  visible: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  const x1 = from[1] * cell + cell / 2;
  const y1 = from[0] * cell + cell / 2;
  const x2 = to[1] * cell + cell / 2;
  const y2 = to[0] * cell + cell / 2;

  if (!visible) return null;

  if (reduced) {
    return (
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="var(--color-surge-charge)"
        strokeWidth={2}
        strokeDasharray="4 4"
        opacity={0.9}
      />
    );
  }

  return (
    <motion.line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke="var(--color-surge-charge)"
      strokeWidth={2.5}
      strokeLinecap="round"
      initial={{ pathLength: 0, opacity: 0.9 }}
      animate={{ pathLength: 1, opacity: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      style={{ filter: "drop-shadow(0 0 6px var(--color-surge-charge))" }}
    />
  );
}