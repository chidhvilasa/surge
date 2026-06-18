import { motion } from "framer-motion";
import type { Player, WinReason } from "@/lib/surge/types";

// back_row/no_legal_moves are the real backend's names for the same two
// concepts the mock called breakthrough/stalemate -- same label reused.
// Worth a human glance in the morning, not a new design decision.
const REASON_LABEL: Record<WinReason, string> = {
  breakthrough: "Breakthrough",
  back_row: "Breakthrough",
  elimination: "Elimination",
  stalemate: "Stalemate",
  no_legal_moves: "Stalemate",
};

export function WinBanner({
  winner,
  reason,
  onNewGame,
}: {
  winner: Player;
  reason?: WinReason;
  onNewGame: () => void;
}) {
  const headline = winner === "A" ? "You win" : "Agent wins";
  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{ background: "rgba(15,17,22,0.78)", backdropFilter: "blur(2px)" }}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 22 }}
        className="px-8 py-6 rounded-md text-center"
        style={{
          background: "var(--color-surface-panel)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(242,197,114,0.25)",
          minWidth: 240,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono-display)",
            fontSize: 11,
            letterSpacing: "0.2em",
            color: "var(--color-victory)",
            textTransform: "uppercase",
          }}
        >
          {reason ? REASON_LABEL[reason] : "Game over"}
        </div>
        <div
          style={{
            fontFamily: "var(--font-sans-ui)",
            fontSize: 28,
            fontWeight: 600,
            color: "white",
            marginTop: 6,
            letterSpacing: "-0.01em",
          }}
        >
          {headline}
        </div>
        <button
          onClick={onNewGame}
          className="mt-5 px-4 py-2 rounded-sm text-sm transition-colors"
          style={{
            fontFamily: "var(--font-sans-ui)",
            background: "var(--color-victory)",
            color: "#1b1e26",
            fontWeight: 600,
            letterSpacing: "0.02em",
          }}
        >
          New game
        </button>
      </motion.div>
    </motion.div>
  );
}