import type { MoveType } from "@/lib/surge/types";

// standard_capture/surge_capture are the capture variants of the real
// backend's standard_move/surge_move -- reusing the same label, same
// mechanism-based taxonomy already used here. Worth a human glance in the
// morning on whether captures deserve their own wording.
const LABELS: Record<MoveType, string> = {
  standard_move: "Standard",
  standard_capture: "Standard",
  surge_move: "Surge",
  surge_capture: "Surge",
  exposed_capture: "Exposed capture",
};

export function MoveTypeBadge({ moveType }: { moveType: MoveType | null }) {
  return (
    <div
      className="h-6 px-2 inline-flex items-center rounded-sm text-[11px] tracking-wider uppercase"
      style={{
        fontFamily: "var(--font-sans-ui)",
        background: "var(--color-surface-panel)",
        color: moveType === "surge_move" || moveType === "surge_capture" || moveType === "exposed_capture"
          ? "var(--color-surge-charge)"
          : "rgba(255,255,255,0.7)",
        opacity: moveType ? 1 : 0,
        transition: "opacity 120ms ease",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {moveType ? LABELS[moveType] : "—"}
    </div>
  );
}