// Placeholder build config -- NOT wired up, NOT installed, nothing
// functional yet. This is scaffolding only, created ahead of actually
// building the extension (a future, separate round of work).
//
// Plan: use the CRXJS Vite plugin (@crxjs/vite-plugin) to bundle this
// manifest + a popup/side-panel React entry point that reuses the existing
// React UI components from frontend/src/components/surge/ and the ported
// rules engine/agent from frontend/src/lib/surge/engine/, via the same
// client.ts swap-point pattern already used for the web app's mock/real
// backend toggle -- here the swap point would select the in-browser
// TypeScript engine instead of fetch() calls to localhost:8000.
//
// Deliberately not installing @crxjs/vite-plugin or any other dependency
// yet -- that's wiring work for a future round once a human has reviewed
// the ported engine/agent in this round.

export default {};
