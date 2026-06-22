import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { GameMode, GameState, Player } from "@/lib/surge/types";
import { RulesOverlay } from "./RulesOverlay";

const DIFFICULTY_LABEL: Record<GameState["difficulty"], string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

function Pips({
  player,
  count,
  flickerKey,
}: {
  player: Player;
  count: number;
  flickerKey: number;
}) {
  const color = player === "A" ? "var(--color-player-a)" : "var(--color-player-b)";
  // 3 pips total. Active = first `count`, the just-spent pip flickers in surge color.
  return (
    <div className="flex items-center gap-1.5">
      {[0, 1, 2].map((i) => {
        const active = i < count;
        const justSpent = i === count && flickerKey > 0; // pip that just turned off
        return (
          <span
            key={i}
            className="relative inline-block w-2 h-2 rounded-full"
            style={{
              background: active ? color : "rgba(255,255,255,0.08)",
              boxShadow: active ? `0 0 6px ${color}55` : "none",
            }}
          >
            {justSpent && (
              <motion.span
                key={flickerKey}
                className="absolute inset-0 rounded-full"
                initial={{ background: "var(--color-surge-charge)", opacity: 1 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                style={{ boxShadow: "0 0 10px var(--color-surge-charge)" }}
              />
            )}
          </span>
        );
      })}
    </div>
  );
}

export function Readout({
  state,
  isAgentThinking,
  mode,
}: {
  state: GameState;
  isAgentThinking: boolean;
  mode: GameMode;
}) {
  const prev = useRef<{ A: number; B: number }>(state.surge_tokens);
  const [flickerA, setFlickerA] = useState(0);
  const [flickerB, setFlickerB] = useState(0);

  useEffect(() => {
    if (state.surge_tokens.A < prev.current.A) setFlickerA((k) => k + 1);
    if (state.surge_tokens.B < prev.current.B) setFlickerB((k) => k + 1);
    prev.current = state.surge_tokens;
  }, [state.surge_tokens]);

  const turnLabel =
    state.winner !== null
      ? `Winner: ${state.winner}`
      : mode === "hotseat"
        ? `Player ${state.current_player}`
        : state.current_player === "A"
          ? "Your turn"
          : "Agent";

  return (
    <div
      className="w-full px-4 py-2.5 flex items-center justify-between gap-4 rounded-sm"
      style={{
        background: "var(--color-surface-panel)",
        fontFamily: "var(--font-mono-display)",
        fontSize: "12px",
        color: "rgba(255,255,255,0.85)",
        letterSpacing: "0.04em",
      }}
    >
      <div className="flex items-center gap-3">
        <motion.div
          className="flex items-center gap-3"
          animate={
            isAgentThinking
              ? { opacity: [1, 0.65, 1] }
              : { opacity: 1 }
          }
          transition={
            isAgentThinking
              ? { duration: 1.3, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0.15 }
          }
          style={
            isAgentThinking
              ? { filter: "drop-shadow(0 0 5px var(--color-player-b))" }
              : undefined
          }
        >
          <span style={{ color: "rgba(255,255,255,0.4)" }}>TURN</span>{" "}
          <span>{turnLabel}</span>
          {mode === "vs_ai" && (
            <span style={{ color: "rgba(255,255,255,0.32)" }}>
              &middot; {DIFFICULTY_LABEL[state.difficulty]}
            </span>
          )}
        </motion.div>
        <RulesOverlay />
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span style={{ color: "var(--color-player-a)" }}>A</span>
          <Pips player="A" count={state.surge_tokens.A} flickerKey={flickerA} />
        </div>
        <div className="flex items-center gap-2">
          <span style={{ color: "var(--color-player-b)" }}>B</span>
          <Pips player="B" count={state.surge_tokens.B} flickerKey={flickerB} />
        </div>
      </div>

      <div className="min-w-[110px] text-right" style={{ color: "rgba(255,255,255,0.55)" }}>
        <AnimatePresence mode="wait">
          {isAgentThinking ? (
            <motion.span
              key="thinking"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.4, 1, 0.4], transition: { duration: 1.2, repeat: Infinity } }}
              exit={{ opacity: 0, transition: { duration: 0.2, repeat: 0 } }}
            >
              Agent thinking…
            </motion.span>
          ) : (
            <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 0.4 }}>
              ready
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}