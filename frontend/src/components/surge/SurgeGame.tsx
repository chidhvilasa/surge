// Surge — top-level game container.
// vs_ai mode: Player A is the human, Player B is the agent.
// hotseat mode: both A and B are human, sharing this device.
// UI never computes legality or wins — it reads legal_moves / winner / exposed
// from GameState.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createGame,
  requestAgentMove,
  submitMove,
} from "@/lib/surge/client";
import { loadStats, recordResult, type SurgeStats } from "@/lib/surge/stats";
import type { Difficulty, GameMode, GameState, Move, Player, Pos } from "@/lib/surge/types";
import { samePos } from "@/lib/surge/types";
import { Board, type PieceRecord } from "./Board";
import { HandoffOverlay } from "./HandoffOverlay";
import { Readout } from "./Readout";
import { SetupScreen } from "./SetupScreen";
import { StatsReadout } from "./StatsReadout";
import { WinBanner } from "./WinBanner";

function piecesFromBoard(board: GameState["board"]): PieceRecord[] {
  const out: PieceRecord[] = [];
  let seq = 0;
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const v = board[r][c];
      if (v) out.push({ id: `p${seq++}_${v}`, owner: v, pos: [r, c], anim: "idle" });
    }
  }
  return out;
}

function applyMoveToPieces(
  pieces: PieceRecord[],
  move: Move,
): { next: PieceRecord[]; captured: PieceRecord[] } {
  const next: PieceRecord[] = [];
  const captured: PieceRecord[] = [];
  const anim: PieceRecord["anim"] =
    move.move_type === "surge_move"
      ? "surge"
      : move.move_type === "exposed_capture"
        ? "exposed_capture"
        : "standard";
  for (const p of pieces) {
    if (samePos(p.pos, move.from_pos)) {
      next.push({ ...p, pos: move.to_pos, anim, fromPos: move.from_pos });
    } else if (samePos(p.pos, move.to_pos)) {
      captured.push({ ...p });
    } else {
      next.push({ ...p, anim: "idle", fromPos: undefined });
    }
  }
  return { next, captured };
}

export function SurgeGame() {
  const [mode, setMode] = useState<GameMode | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("hard");
  const [state, setState] = useState<GameState | null>(null);
  const [pieces, setPieces] = useState<PieceRecord[]>([]);
  const [captured, setCaptured] = useState<PieceRecord[]>([]);
  const [selectedFrom, setSelectedFrom] = useState<Pos | null>(null);
  const [isAgentThinking, setIsAgentThinking] = useState(false);
  const [awaitingHandoff, setAwaitingHandoff] = useState(false);
  const [surgeTrail, setSurgeTrail] = useState<
    { from: Pos; to: Pos; key: number } | null
  >(null);
  const [initialOrchestrated, setInitialOrchestrated] = useState(false);
  const trailKey = useRef(0);
  const [stats, setStats] = useState<SurgeStats | null>(null);
  // Per-game_id guard so a finished game's result is recorded exactly once,
  // even across re-renders -- the same bug class the backend's
  // record_finished_game() guards against with recorded_games.
  const recordedGameIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    void loadStats().then(setStats);
  }, []);

  const start = useCallback(async (nextMode: GameMode, nextDifficulty: Difficulty) => {
    setMode(nextMode);
    setDifficulty(nextDifficulty);
    setSelectedFrom(null);
    setCaptured([]);
    setSurgeTrail(null);
    setIsAgentThinking(false);
    setAwaitingHandoff(false);
    setInitialOrchestrated(true);
    const s = await createGame(nextDifficulty);
    setState(s);
    setPieces(piecesFromBoard(s.board));
    // Let the staggered settle play, then disable orchestration so subsequent
    // updates are smooth.
    setTimeout(() => setInitialOrchestrated(false), 600);
  }, []);

  const animateMove = useCallback(
    (prevPieces: PieceRecord[], move: Move) => {
      const { next, captured: cap } = applyMoveToPieces(prevPieces, move);
      if (move.move_type === "surge_move") {
        trailKey.current += 1;
        setSurgeTrail({
          from: move.from_pos,
          to: move.to_pos,
          key: trailKey.current,
        });
        setTimeout(() => setSurgeTrail(null), 600);
      }
      setPieces(next);
      setCaptured(cap);
      // Clear capture fade list after the fade settles.
      if (cap.length > 0) {
        setTimeout(() => setCaptured([]), 500);
      }
    },
    [],
  );

  const onCommit = useCallback(
    async (move: Move) => {
      if (!state) return;
      setSelectedFrom(null);
      // Animate optimistically using the submitted move; await server confirm.
      const prev = pieces;
      animateMove(prev, move);
      try {
        const next = await submitMove(state.game_id, move);
        setState(next);
        // Hotseat: the device physically changes hands every turn, not
        // just at game start -- require an explicit handoff confirmation
        // before the next player's pieces/position are visible.
        if (mode === "hotseat" && next.winner === null) {
          setAwaitingHandoff(true);
        }
      } catch (e) {
        console.error(e);
        // Roll back: refetch state by replaying pieces from authoritative state.
        if (state) setPieces(piecesFromBoard(state.board));
      }
    },
    [state, pieces, animateMove, mode],
  );

  // Agent turn driver -- vs_ai only. In hotseat both sides are human, so
  // /agent-move must never be called for either side.
  useEffect(() => {
    if (mode !== "vs_ai") return;
    if (!state) return;
    if (state.winner !== null) return;
    if (state.current_player !== "B") return;
    if (isAgentThinking) return;
    let cancelled = false;
    setIsAgentThinking(true);
    setSelectedFrom(null);
    (async () => {
      try {
        const { movePlayed, state: nextState } = await requestAgentMove(
          state.game_id,
        );
        if (cancelled) return;
        animateMove(pieces, movePlayed);
        setState(nextState);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setIsAgentThinking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, state?.current_player, state?.winner, state?.game_id]);

  // Stats recorder: fires once per finished game_id, vs_ai only -- hotseat
  // has no human-vs-agent side to attribute a win/loss to, so it must stay
  // entirely out of this tracker rather than recording something meaningless.
  // ("local" mode's own agent-table persistence in client.ts is a separate
  // concern -- this is purely win/loss bookkeeping for the human.)
  useEffect(() => {
    if (mode !== "vs_ai") return;
    if (!state) return;
    if (state.winner === null) return;
    if (recordedGameIds.current.has(state.game_id)) return;
    recordedGameIds.current.add(state.game_id);
    void recordResult(state.winner).then(setStats);
  }, [mode, state?.winner, state?.game_id]);

  if (mode === null) {
    return <SetupScreen onStart={(m, d) => void start(m, d)} />;
  }

  if (!state) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{
          background: "var(--color-bg-field)",
          color: "rgba(255,255,255,0.4)",
          fontFamily: "var(--font-mono-display)",
          fontSize: 12,
          letterSpacing: "0.2em",
        }}
      >
        LOADING
      </div>
    );
  }

  const localPlayers: Player[] = mode === "hotseat" ? ["A", "B"] : ["A"];
  const disabled =
    state.winner !== null ||
    awaitingHandoff ||
    (mode === "vs_ai" && (isAgentThinking || state.current_player !== "A"));

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-start px-4 py-6 gap-4 relative"
      style={{ background: "var(--color-bg-field)" }}
    >
      <header className="w-full max-w-[420px] flex items-baseline justify-between">
        <h1
          style={{
            fontFamily: "var(--font-sans-ui)",
            fontWeight: 600,
            fontSize: 18,
            letterSpacing: "0.2em",
            color: "white",
            textTransform: "uppercase",
          }}
        >
          Surge
        </h1>
        <span
          style={{
            fontFamily: "var(--font-mono-display)",
            fontSize: 10,
            letterSpacing: "0.18em",
            color: "rgba(255,255,255,0.35)",
            textTransform: "uppercase",
          }}
        >
          {mode === "hotseat" ? "Local 2-player" : "You · A"}
        </span>
      </header>

      <div className="w-full max-w-[420px]">
        <Readout state={state} isAgentThinking={isAgentThinking} mode={mode} />
      </div>

      {mode === "vs_ai" && stats && (
        <div className="w-full max-w-[420px]">
          <StatsReadout stats={stats} />
        </div>
      )}

      <div className="relative">
        <Board
          state={state}
          pieces={pieces}
          capturedThisTurn={captured}
          selectedFrom={selectedFrom}
          onSelect={setSelectedFrom}
          onCommit={onCommit}
          disabled={disabled}
          isAgentThinking={isAgentThinking}
          surgeTrail={surgeTrail}
          initialOrchestrated={initialOrchestrated}
          localPlayers={localPlayers}
        />
        {awaitingHandoff && state.winner === null && (
          <HandoffOverlay
            nextPlayer={state.current_player}
            onReady={() => setAwaitingHandoff(false)}
          />
        )}
        {state.winner !== null && (
          <WinBanner
            winner={state.winner as Player}
            reason={state.win_reason}
            onNewGame={() => void start(mode, difficulty)}
          />
        )}
      </div>

      <p
        className="text-center max-w-[420px]"
        style={{
          fontFamily: "var(--font-sans-ui)",
          fontSize: 11,
          color: "rgba(255,255,255,0.32)",
          letterSpacing: "0.04em",
          lineHeight: 1.6,
        }}
      >
        Move forward — straight into empty, diagonal to capture. Spend a Surge
        token to jump two squares, but the landing piece is{" "}
        <span style={{ color: "var(--color-surge-charge)" }}>exposed</span>{" "}
        until your next turn.
      </p>
    </div>
  );
}
