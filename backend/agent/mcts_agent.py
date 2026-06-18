"""Monte Carlo Tree Search agent with UCB1 exploration for Surge.

No external services or APIs are involved in move selection: the agent's
only inputs are the current GameState and its own on-disk visit/value
table. Training (train_self_play.py) repeatedly calls `search()` from
self-play games; each call both picks a move and deepens the persisted
table, so skill accumulates across sessions.
"""
from __future__ import annotations

import math
import os
import pickle
import random
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
    ):
        self.policy_path = policy_path
        self.c = exploration_c
        self.n_simulations = n_simulations
        self.rollout_depth_cap = rollout_depth_cap
        self.rng = rng or random.Random()
        # state_key -> {action_key: [visit_count, total_value]}
        self.table: dict[StateKey, dict[ActionKey, list]] = {}
        self.load()

    def load(self) -> None:
        if os.path.exists(self.policy_path):
            with open(self.policy_path, "rb") as f:
                self.table = pickle.load(f)

    def save(self) -> None:
        os.makedirs(os.path.dirname(self.policy_path), exist_ok=True)
        with open(self.policy_path, "wb") as f:
            pickle.dump(self.table, f, protocol=pickle.HIGHEST_PROTOCOL)

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
        use the exact same table update rule."""
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

    def search(self, state: GameState) -> Move:
        if state.is_over():
            raise ValueError("Cannot search from a terminal state")

        for _ in range(self.n_simulations):
            self._simulate(state)

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
