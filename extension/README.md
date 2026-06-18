# Surge — Chrome Extension (scaffolding only)

Nothing in this folder is functional yet. This is placeholder structure
created on the `chrome-extension` branch ahead of the actual build, per the
phased plan:

- **Phase 1** (this round): port `backend/rules_engine/` to TypeScript at
  `frontend/src/lib/surge/engine/`, with a 1:1 ported test suite.
- **Phase 2** (this round): port the MCTS agent to TypeScript, live search
  only (no precomputed table), benchmarked in Node against a random bot.
- **Phase 3** (future round, needs a human + a real browser): wire the
  engine/agent into this `extension/` folder via the CRXJS Vite plugin (or
  equivalent), build the popup/side-panel UI by reusing the existing React
  components from `frontend/src/components/surge/`, and pick real
  in-browser-tested difficulty defaults.

See `EXTENSION_PHASE1_2_LOG.md` at the repo root for what's actually been
done, the real test/benchmark output, and open questions flagged for human
review before Phase 3 starts.

This folder intentionally does **not** contain a second copy of the rules
engine or agent -- that lives once, at `frontend/src/lib/surge/engine/`, so
both the web app and this extension can share it.
