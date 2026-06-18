import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { GameState, Player } from "@/lib/surge/types";

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
}: {
  state: GameState;
  isAgentThinking: boolean;
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
      <div className="flex items-center gap-2">
        <span style={{ color: "rgba(255,255,255,0.4)" }}>TURN</span>
        <span>{turnLabel}</span>
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
              animate={{ opacity: [0.4, 1, 0.4] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.2, repeat: Infinity }}
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