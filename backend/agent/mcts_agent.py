"""Monte Carlo Tree Search agent with UCB1 exploration for Surge.

No external services or APIs are involved in move selection: the agent's
only inputs are the current GameState and its own on-disk visit/value
table. Training (train_self_play.py) repeatedly calls `search()` from
self-play games; each call both picks a move and deepens the persisted
table, so skill accumulates across sessions.
"""
from __future__ import annotations

import concurrent.futures
import math
import os
import pickle
import random
import tempfile
import threading
from typing import Optional

from rules_engine.game_state import GameState
from rules_engine.moves import Move, apply_move, generate_legal_moves

DEFAULT_POLICY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "policy_store", "mcts_policy.pkl")

ActionKey = tuple
StateKey = tuple


def move_key(move: Move) -> ActionKey:
    return (move.from_pos, move.to_pos, move.move_type)


class MCTSAgent:
    def __init__(
        self,
        policy_path: str = DEFAULT_POLICY_PATH,
        exploration_c: float = 1.4,
        n_simulations: int = 150,
        rollout_depth_cap: int = 150,
        rng: Optional[random.Random] = None,
        max_search_seconds: float = 10.0,
        lazy: bool = False,
    ):
        self.policy_path = policy_path
        self.c = exploration_c
        self.n_simulations = n_simulations
        self.rollout_depth_cap = rollout_depth_cap
        self.rng = rng or random.Random()
        # Defensive wall-clock cutoff for search(), independent of whatever
        # actually causes a slow simulation (an unexplained ~76s outlier
        # was found in production -- real cause undetermined, most likely
        # OS-level page faults reloading a large table that had been
        # swapped out under memory pressure, but not proven). 10s is well
        # above any normal search at any difficulty tier (typically
        # sub-second, even on the ~2.3M-entry table) and still short enough
        # that a real person waiting on a move never sees an unbounded
        # stall, whatever the cause turns out to be.
        self.max_search_seconds = max_search_seconds
        # state_key -> {action_key: [visit_count, total_value]}
        self.table: dict[StateKey, dict[ActionKey, list]] = {}
        self._loaded = False
        # Guards self.table's *key-set* (not its values) against the
        # background save path observing a size change mid-pickle: every
        # write that adds/removes a top-level key (_backpropagate, unload)
        # takes this lock briefly; snapshot_table() takes it just as
        # briefly to copy the key-set before handing the copy to pickle,
        # which then runs with no lock held at all. A real production
        # crash (RuntimeError: dictionary changed size during iteration,
        # in pickle.dump() while a concurrent search() was still adding
        # newly-discovered states) is what this exists to prevent.
        self._table_lock = threading.Lock()
        # lazy=True defers the actual pickle load (measured at multiple
        # seconds and, for the largest table, multiple GB of resident
        # memory) until ensure_loaded() is called -- used by the API layer
        # to keep only the actively-used difficulty tier's table resident,
        # not all three simultaneously. Every other caller (training
        # scripts, benchmarks, tests) is unaffected: lazy defaults to
        # False, so the table loads immediately exactly as before.
        if not lazy:
            self.load()

    def ensure_loaded(self) -> None:
        if not self._loaded:
            self.load()

    def load(self) -> None:
        if os.path.exists(self.policy_path):
            with open(self.policy_path, "rb") as f:
                self.table = pickle.load(f)
        self._loaded = True

    def unload(self) -> dict:
        """Drop this agent's in-memory table so it can be garbage
        collected, returning the table that was dropped so the caller can
        arrange for it to actually be persisted -- this method intentionally
        does not save it itself, since a real measured save of the largest
        tier's table takes ~32s, far too long to make the request that
        triggered a tier switch sit and wait for it.

        Takes _table_lock for the swap itself so a _backpropagate() call
        that's mid-loop over several path entries can't have some entries
        land in the table being handed off here and others land in the
        fresh one that replaces it."""
        with self._table_lock:
            old_table = self.table
            self.table = {}
        self._loaded = False
        return old_table

    def snapshot_table(self) -> dict:
        """A shallow copy of self.table's current key-set, taken under
        _table_lock so the copy can't be mid-resized by a concurrent
        _backpropagate() call. Hand this to pickle instead of the live
        table: pickling the live table directly, while a concurrent
        search() was still discovering new states, raised a real
        production RuntimeError ("dictionary changed size during
        iteration"). The copy is shallow -- the per-state inner dicts are
        still the same objects the live table uses -- which is enough to
        fix the *outer* dict's size changing mid-pickle (by far the common
        case: nearly every simulation discovers some brand-new state),
        though a concurrent call adding a brand-new action to an
        already-visited state's inner dict during that same pickle remains
        a narrower, unaddressed case."""
        with self._table_lock:
            return dict(self.table)

    def save(self, table: Optional[dict] = None) -> None:
        """Write `table` (default: self.table) to self.policy_path
        atomically: pickle to a temp file in the same directory, then
        os.replace() it onto the real path. A reader can never observe a
        partially-written file, and a process that dies mid-save can't
        leave the production policy corrupted -- the original file is
        untouched until the temp file is fully written.

        Accepts an explicit `table` so a caller that just unload()'ed this
        agent (which replaces self.table with a fresh empty dict) can still
        persist the table that was actually dropped, not the empty one."""
        table_to_save = table if table is not None else self.table
        directory = os.path.dirname(self.policy_path)
        os.makedirs(directory, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=directory, prefix=".tmp_policy_", suffix=".pkl")
        try:
            with os.fdopen(fd, "wb") as f:
                pickle.dump(table_to_save, f, protocol=pickle.HIGHEST_PROTOCOL)
            os.replace(tmp_path, self.policy_path)
        except Exception:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            raise

    def _ucb_select(self, state_key: StateKey, legal_moves: list[Move]) -> Move:
        node = self.table.get(state_key, {})
        total_n = sum(node[move_key(m)][0] for m in legal_moves if move_key(m) in node) + 1
        log_total = math.log(total_n)

        best_move = legal_moves[0]
        best_score = -float("inf")
        for m in legal_moves:
            stats = node.get(move_key(m))
            if stats is None or stats[0] == 0:
                return m  # always try an unvisited action first
            n, w = stats
            q = w / n
            u = self.c * math.sqrt(log_total / n)
            score = q + u
            if score > best_score:
                best_score = score
                best_move = m
        return best_move

    def _rollout_policy(self, legal_moves: list[Move]) -> Move:
        return self.rng.choice(legal_moves)

    def _simulate(self, root_state: GameState) -> None:
        path: list[tuple[StateKey, ActionKey, str]] = []
        state = root_state
        depth = 0
        expanded_new_node = False

        while not state.is_over() and depth < self.rollout_depth_cap and not expanded_new_node:
            legal = generate_legal_moves(state)
            if not legal:
                break
            state_key = state.state_key()
            move = self._ucb_select(state_key, legal)
            action_key = move_key(move)
            path.append((state_key, action_key, state.current_player))

            node = self.table.get(state_key, {})
            stats = node.get(action_key)
            if stats is None or stats[0] == 0:
                expanded_new_node = True

            # move came straight out of generate_legal_moves(state) above,
            # so it's legal in this exact state by construction -- skip the
            # redundant re-validation apply_move would otherwise do.
            state = apply_move(state, move, validate=False)
            depth += 1

        # Rollout to terminal with a uniform-random policy.
        while not state.is_over() and depth < self.rollout_depth_cap:
            legal = generate_legal_moves(state)
            if not legal:
                break
            state = apply_move(state, self._rollout_policy(legal), validate=False)
            depth += 1

        self._backpropagate(path, state.winner)

    def _backpropagate(self, path: list[tuple[StateKey, ActionKey, str]], winner: Optional[str]) -> None:
        """Update visit count and value for every (state, action) edge in
        `path` given the eventual `winner`. Shared by self-play simulation
        rollouts and by real-game updates (update_from_trajectory) so both
        use the exact same table update rule.

        Holds _table_lock for the whole loop (not per-entry) -- `path` is
        bounded by rollout_depth_cap and typically much shorter in
        practice, so this is brief regardless, and a single acquisition
        also guarantees every entry in one simulation's path lands
        together rather than split across a concurrent unload() swap."""
        with self._table_lock:
            for state_key, action_key, player in path:
                node = self.table.setdefault(state_key, {})
                stats = node.setdefault(action_key, [0, 0.0])
                stats[0] += 1
                if winner is None:
                    result = 0.0
                elif winner == player:
                    result = 1.0
                else:
                    result = -1.0
                stats[1] += result

    def update_from_trajectory(self, history: list[tuple[StateKey, ActionKey, str]], winner: Optional[str]) -> None:
        """Fold a real, already-played game's trajectory into the table
        using the same backup rule as self-play, without running any new
        simulated rollouts."""
        self._backpropagate(history, winner)

    def _run_simulations(self, state: GameState, stop: threading.Event) -> None:
        for _ in range(self.n_simulations):
            if stop.is_set():
                return
            self._simulate(state)

    def search(self, state: GameState) -> Move:
        if state.is_over():
            raise ValueError("Cannot search from a terminal state")

        # Run simulations on a worker thread and bound by wall-clock time
        # from the outside, rather than checking a deadline between loop
        # iterations on this (the calling) thread: that alone can't help if
        # a single _simulate() call is itself the slow one (confirmed in
        # production -- an outer per-iteration deadline of 10s still let one
        # run take 59s total, because the deadline was only ever checked
        # between calls on the same thread that was blocked).
        #
        # On timeout, `stop` is set so the worker thread actually exits its
        # loop (checked between calls) rather than being merely abandoned --
        # an abandoned thread left to run its full remaining n_simulations
        # was found to keep contending for the GIL with this thread's own
        # wrap-up work below, in one case adding another ~9s on top of the
        # configured 10s cap before this method actually returned. With the
        # stop signal, the worker yields the GIL back promptly after its
        # current call finishes instead of plowing through the rest of its
        # loop.
        stop = threading.Event()
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        future = executor.submit(self._run_simulations, state, stop)
        try:
            future.result(timeout=self.max_search_seconds)
        except concurrent.futures.TimeoutError:
            stop.set()
        executor.shutdown(wait=False)

        legal = generate_legal_moves(state)
        node = self.table.get(state.state_key(), {})

        def robustness(m: Move) -> tuple[int, float]:
            stats = node.get(move_key(m))
            if not stats or stats[0] == 0:
                return (0, -float("inf"))
            n, w = stats
            return (n, w / n)

        return max(legal, key=robustness)

    def choose_move(self, state: GameState) -> Move:
        return self.search(state)
