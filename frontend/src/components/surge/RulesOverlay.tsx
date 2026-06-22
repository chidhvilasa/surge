import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

type Rule = { n: number; text: string };
type Section = { label: string; rules: Rule[]; accent?: "victory" };

const SECTIONS: Section[] = [
  {
    label: "SETUP",
    rules: [{ n: 1, text: "5x6 board, 5 pieces each, filling your own back row." }],
  },
  {
    label: "MOVEMENT",
    rules: [
      { n: 2, text: "Move one square forward, straight or diagonal. Straight moves can't capture, diagonal moves can." },
      { n: 3, text: "No sideways or backward moves, ever." },
    ],
  },
  {
    label: "SURGE",
    rules: [
      { n: 4, text: "Surge: 3 tokens per game, jump 2 squares forward, skipping whatever's in between, captures if landing on an enemy." },
      { n: 5, text: "A piece that just Surged is Exposed until your next turn, capturable from any direction with no token cost." },
    ],
  },
  {
    label: "WIN CONDITIONS",
    accent: "victory",
    rules: [
      { n: 6, text: "Reach the opponent's back row to win instantly, even by capturing into it." },
      { n: 7, text: "Eliminate all enemy pieces to win." },
      { n: 8, text: "If your opponent has no legal move on their turn, you win." },
    ],
  },
];

// Highlights "Surge"/"Surged"/"Exposed" in the reserved surge-charge violet,
// the same treatment the in-game move-hint caption already uses for "exposed".
function highlightTerms(text: string) {
  const parts = text.split(/(\bSurge\w*\b|\bExposed\b)/g);
  return parts.map((part, i) =>
    /^(Surge\w*|Exposed)$/.test(part) ? (
      <span key={i} style={{ color: "var(--color-surge-charge)" }}>
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function RulesOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        style={{
          fontFamily: "var(--font-mono-display)",
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.4)",
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 3,
          padding: "4px 8px",
          cursor: "pointer",
          transition: "color 150ms ease, border-color 150ms ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "rgba(255,255,255,0.85)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "rgba(255,255,255,0.4)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
        }}
      >
        Rules
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Surge rules"
            className="fixed inset-0 flex items-center justify-center z-50 px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ background: "rgba(15,17,22,0.78)", backdropFilter: "blur(2px)" }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
              onClick={(e) => e.stopPropagation()}
              className="rounded-md"
              style={{
                background: "var(--color-surface-panel)",
                boxShadow: "0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)",
                maxWidth: "clamp(360px, 90vw, 760px)",
                width: "100%",
                padding: "52px",
                maxHeight: "85vh",
                overflowY: "auto",
              }}
            >
              <div className="flex items-baseline justify-between mb-8">
                <h2
                  style={{
                    fontFamily: "var(--font-mono-display)",
                    fontSize: 13,
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    color: "rgba(255,255,255,0.5)",
                  }}
                >
                  Rules
                </h2>
              </div>

              <div className="flex flex-col gap-9">
                {SECTIONS.map((section) => (
                  <div
                    key={section.label}
                    style={
                      section.accent === "victory"
                        ? { borderLeft: "2px solid var(--color-victory)", paddingLeft: 16 }
                        : undefined
                    }
                  >
                    <h3
                      style={{
                        fontFamily: "var(--font-mono-display)",
                        fontSize: 11,
                        letterSpacing: "0.16em",
                        textTransform: "uppercase",
                        color:
                          section.accent === "victory"
                            ? "var(--color-victory)"
                            : "rgba(255,255,255,0.4)",
                        marginBottom: 14,
                      }}
                    >
                      {section.label}
                    </h3>
                    <ul className="flex flex-col gap-4">
                      {section.rules.map((rule) => (
                        <li key={rule.n} className="flex items-start gap-3">
                          <span
                            style={{
                              fontFamily: "var(--font-mono-display)",
                              fontSize: 12,
                              color: "rgba(255,255,255,0.32)",
                              minWidth: 18,
                              flexShrink: 0,
                              lineHeight: 1.6,
                            }}
                          >
                            {rule.n}
                          </span>
                          <span
                            style={{
                              fontFamily: "var(--font-sans-ui)",
                              fontSize: 15,
                              lineHeight: 1.6,
                              color: "rgba(255,255,255,0.82)",
                            }}
                          >
                            {highlightTerms(rule.text)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setOpen(false)}
                className="mt-10 px-4 py-2 rounded-sm text-sm transition-colors"
                style={{
                  fontFamily: "var(--font-sans-ui)",
                  background: "var(--color-victory)",
                  color: "#1b1e26",
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                }}
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
