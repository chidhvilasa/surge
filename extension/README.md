# Surge — Chrome Extension

Manifest V3 extension. Click the toolbar icon to open the game in its own
tab (not a small popup -- the board needs real space). No network calls of
any kind: the rules engine and MCTS agent both run entirely in-browser, the
same TypeScript port at `frontend/src/lib/surge/engine/` that the web app's
"local" client mode also uses.

This folder intentionally does **not** contain a second copy of the rules
engine, agent, or UI components -- those live once, under `frontend/src/`,
and this extension imports them directly (see `vite.config.ts`'s `@` alias
and `src/main.tsx`).

## Build

```
bun install
bun run build
```

Output goes to `dist/`. To load it: `chrome://extensions` -> enable
Developer mode -> Load unpacked -> select `extension/dist/`.

## How it's wired

- `client.ts` (the same swap point the web app uses for mock/real backend)
  is built here with `VITE_SURGE_MODE=local`, routing every call to the
  ported TypeScript engine/agent instead of `fetch()`.
- The agent starts with a completely empty table -- no precomputed
  snapshot is shipped -- and persists what it learns to
  `chrome.storage.local`, so it keeps improving across sessions on this
  one installation. Win/loss stats persist the same way.
- `permissions: ["storage"]` only. No host permissions, no `tabs`
  permission -- `chrome.tabs.create()` with the extension's own URL doesn't
  require it.

## History

Built across three rounds on this branch:

- **Phase 1**: ported `backend/rules_engine/` to TypeScript at
  `frontend/src/lib/surge/engine/`, with a 1:1 ported test suite.
- **Phase 2**: ported the MCTS agent to TypeScript, live search only (no
  precomputed table), benchmarked in Node against a random bot.
- **Phase 3**: this build -- `client.ts`'s `"local"` mode, the CRXJS-based
  build in this folder, the real manifest/icons, and `chrome.storage.local`
  persistence for both stats and the agent's table.

See `EXTENSION_PHASE1_2_LOG.md` at the repo root for Phase 1-2's real
test/benchmark output.
