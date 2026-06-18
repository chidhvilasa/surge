import type { GameState, Move } from "./types";

// extractState normalizes endpoint responses to a flat GameState.
// Both real backend and mock already return the canonical shape, so this is
// mostly a pass-through with light field renaming for agent-move.

export function extractState(
  response: unknown,
  endpointType: "create" | "submit" | "agent-move",
): { state: GameState; movePlayed?: Move } {
  const r = response as Record<string, unknown>;
  if (endpointType === "agent-move") {
    const state = (r.state ?? r) as GameState;
    const movePlayed = (r.move_played ?? r.movePlayed) as Move | undefined;
    return { state, movePlayed };
  }
  // For create/submit the backend may return either the state directly or
  // wrapped under { state }.
  const state = (r.state ?? r) as GameState;
  return { state };
}