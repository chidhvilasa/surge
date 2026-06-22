import { useState } from "react";
import type { Difficulty, GameMode } from "@/lib/surge/types";

const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

function ChoiceButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 rounded-sm text-sm transition-colors"
      style={{
        fontFamily: "var(--font-sans-ui)",
        fontWeight: 600,
        letterSpacing: "0.02em",
        background: active ? "var(--color-victory)" : "transparent",
        color: active ? "#1b1e26" : "rgba(255,255,255,0.6)",
        border: active ? "none" : "1px solid rgba(255,255,255,0.16)",
      }}
    >
      {children}
    </button>
  );
}

export function SetupScreen({
  onStart,
}: {
  onStart: (mode: GameMode, difficulty: Difficulty) => void;
}) {
  const [mode, setMode] = useState<GameMode>("vs_ai");
  const [difficulty, setDifficulty] = useState<Difficulty>("hard");

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 gap-8"
      style={{ background: "var(--color-bg-field)" }}
    >
      <h1
        style={{
          fontFamily: "var(--font-sans-ui)",
          fontWeight: 600,
          fontSize: 22,
          letterSpacing: "0.2em",
          color: "white",
          textTransform: "uppercase",
        }}
      >
        Surge
      </h1>

      <div className="flex flex-col items-center gap-3">
        <span
          style={{
            fontFamily: "var(--font-mono-display)",
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.4)",
          }}
        >
          Mode
        </span>
        <div className="flex gap-2">
          <ChoiceButton active={mode === "vs_ai"} onClick={() => setMode("vs_ai")}>
            vs AI
          </ChoiceButton>
          <ChoiceButton active={mode === "hotseat"} onClick={() => setMode("hotseat")}>
            Local 2-player
          </ChoiceButton>
        </div>
      </div>

      {mode === "vs_ai" && (
        <div className="flex flex-col items-center gap-3">
          <span
            style={{
              fontFamily: "var(--font-mono-display)",
              fontSize: 11,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.4)",
            }}
          >
            Difficulty
          </span>
          <div className="flex gap-2">
            {DIFFICULTIES.map((d) => (
              <ChoiceButton key={d.value} active={difficulty === d.value} onClick={() => setDifficulty(d.value)}>
                {d.label}
              </ChoiceButton>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => onStart(mode, difficulty)}
        className="px-6 py-3 rounded-sm text-sm transition-colors mt-2"
        style={{
          fontFamily: "var(--font-sans-ui)",
          background: "var(--color-victory)",
          color: "#1b1e26",
          fontWeight: 600,
          letterSpacing: "0.02em",
        }}
      >
        Start game
      </button>
    </div>
  );
}
