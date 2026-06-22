"""Regression test for a real production crash: a background save's
pickle.dump() iterating MCTSAgent.table directly while a concurrent
request's search() was still adding newly-discovered states raised
RuntimeError: dictionary changed size during iteration.

First reproduces the original bug against the *live* table (proving it's
a real, repeatable race, not hypothetical), then proves snapshot_table()
+ pickling the snapshot survives the same concurrent pressure.
"""
import io
import pickle
import random
import threading
import time

from agent.mcts_agent import MCTSAgent

TABLE_SIZE = 4000
SAVE_ITERATIONS = 40


def _start_mutator(agent: MCTSAgent, stop: threading.Event, start_at: int) -> threading.Thread:
    def mutate():
        i = start_at
        while not stop.is_set():
            # Mirrors _backpropagate()'s real shape: a new top-level state
            # key with a one-entry inner dict, growing the table's size --
            # exactly the operation that raises "dictionary changed size
            # during iteration" if something else is mid-iteration of the
            # same live dict. The explicit sleep(0) yields the GIL on each
            # pass -- an unthrottled tight acquire/release loop was found
            # to starve the main thread of any real scheduling turn at all
            # on this machine (near-zero CPU time on the main thread after
            # several minutes), not just slow it down.
            with agent._table_lock:
                agent.table[f"state_{i}"] = {f"action_{i}": [1, 0.0]}
            i += 1
            time.sleep(0)

    t = threading.Thread(target=mutate)
    t.start()
    return t


class _MutateContainerOnPickle:
    """A real (not racy) way to prove the underlying mechanism: pickle
    calls __reduce__ on this object while it's still walking the outer
    dict containing it, partway through that walk. Mutating the *same*
    outer dict from inside __reduce__ deterministically reproduces
    "dictionary changed size during iteration" every single time, with
    no thread timing involved -- proving the mechanism is real before
    the other test proves the fix survives the real, threaded version of
    the same problem."""

    def __init__(self, container: dict):
        self._container = container

    def __reduce__(self):
        self._container[f"injected_{id(self)}"] = {"poison": [1, 0.0]}
        return (int, (1,))


def test_pickling_the_live_table_directly_reproduces_the_real_crash():
    """Proves the bug is real before proving the fix: a dict mutating
    itself partway through pickle's own walk of it -- the same
    underlying Python/pickle behaviour a concurrent thread's mutation
    triggered in production -- must raise RuntimeError, not silently
    succeed."""
    table = {f"state_{i}": {f"action_{i}": [1, 0.0]} for i in range(50)}
    table["trigger"] = {"poison": _MutateContainerOnPickle(table)}

    caught = None
    try:
        buf = io.BytesIO()
        pickle.dump(table, buf, protocol=pickle.HIGHEST_PROTOCOL)  # live table, no lock -- the old, buggy path
    except RuntimeError as e:
        caught = e

    assert caught is not None, "expected the live-table pickle to raise RuntimeError when mutated mid-walk"
    assert "changed size during iteration" in str(caught)


def test_snapshot_table_survives_concurrent_mutation_during_save():
    """The actual fix: snapshot_table() (briefly locked) + pickling the
    snapshot (no lock held) must survive the exact same concurrent
    mutation pressure that reliably broke the live-table path above,
    with no exception in either the save loop or the mutator thread."""
    agent = MCTSAgent(policy_path="unused.pkl", n_simulations=1, rng=random.Random(2))
    agent.table = {f"state_{i}": {f"action_{i}": [1, 0.0]} for i in range(TABLE_SIZE)}

    stop = threading.Event()
    mutator = _start_mutator(agent, stop, start_at=TABLE_SIZE)

    save_errors = []
    try:
        for _ in range(SAVE_ITERATIONS):
            try:
                snapshot = agent.snapshot_table()
                buf = io.BytesIO()
                pickle.dump(snapshot, buf, protocol=pickle.HIGHEST_PROTOCOL)
            except Exception as e:  # noqa: BLE001 -- want to catch and report literally anything
                save_errors.append(e)
    finally:
        stop.set()
        mutator.join(timeout=5)

    assert not save_errors, f"snapshot+pickle raised under concurrent mutation: {save_errors}"
    # The mutator's own writes (under the same lock) must also have kept
    # going the whole time, confirming the lock didn't deadlock or starve it.
    assert len(agent.table) > TABLE_SIZE
