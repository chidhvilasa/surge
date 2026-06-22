import { motion } from "framer-motion";
import type { Player } from "@/lib/surge/types";

// Explicit device-changes-hands moment for hotseat: the board is hidden
// behind this until the incoming player confirms, so the player who just
// moved can't keep seeing the board after handing the device over.
export function HandoffOverlay({
  nextPlayer,
  onReady,
}: {
  nextPlayer: Player;
  onReady: () => void;
}) {
  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center z-40"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      style={{ background: "rgba(15,17,22,0.94)", backdropFilter: "blur(4px)" }}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
        className="px-8 py-6 rounded-md text-center"
        style={{
          background: "var(--color-surface-panel)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)",
          minWidth: 240,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono-display)",
            fontSize: 11,
            letterSpacing: "0.2em",
            color: nextPlayer === "A" ? "var(--color-player-a)" : "var(--color-player-b)",
            textTransform: "uppercase",
          }}
        >
          Pass the device
        </div>
        <div
          style={{
            fontFamily: "var(--font-sans-ui)",
            fontSize: 24,
            fontWeight: 600,
            color: "white",
            marginTop: 6,
          }}
        >
          Player {nextPlayer}'s turn
        </div>
        <button
          onClick={onReady}
          className="mt-5 px-4 py-2 rounded-sm text-sm transition-colors"
          style={{
            fontFamily: "var(--font-sans-ui)",
            background: "var(--color-victory)",
            color: "#1b1e26",
            fontWeight: 600,
            letterSpacing: "0.02em",
          }}
        >
          I'm Player {nextPlayer}, go
        </button>
      </motion.div>
    </motion.div>
  );
}
