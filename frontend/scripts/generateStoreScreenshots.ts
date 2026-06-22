// Generates the Chrome Web Store screenshots: real game states captured
// from the actual running app (uvicorn on :8000, bun run dev on :8080),
// not mockups. Each screenshot gets its own fresh browser context.
//
// Run with: node --experimental-strip-types scripts/generateStoreScreenshots.ts
// (NOT bun -- Playwright's pipe-based CDP transport doesn't complete its
// handshake under Bun on this machine; see verifyPartB.ts's header comment
// for the full story.)

import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.resolve(__dirname, "..", "..", "docs", "store_screenshots");
mkdirSync(SHOT_DIR, { recursive: true });

const BASE_URL = "http://localhost:8080";
const COLS = 5;
const ROWS = 6;
const VIEWPORT = { width: 1280, height: 800 };

function domIndex(boardRow: number, boardCol: number): number {
  const visualRow = ROWS - 1 - boardRow;
  return visualRow * COLS + boardCol;
}

async function newContext(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  return context.newPage();
}

async function clickCell(page: Page, row: number, col: number) {
  await page.locator('[role="gridcell"]').nth(domIndex(row, col)).click();
}

async function waitForCellSelectable(page: Page, row: number, col: number, timeoutMs = 30000): Promise<void> {
  const cell = page.locator('[role="gridcell"]').nth(domIndex(row, col));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cursor = await cell.evaluate((el) => getComputedStyle(el).cursor);
    if (cursor === "pointer") return;
    await page.waitForTimeout(25);
  }
  throw new Error(`Cell (${row},${col}) never became selectable within ${timeoutMs}ms`);
}

// Finds whichever gridcell is actually selectable right now, rather than
// assuming a specific square survived combat -- a piece I moved earlier
// in a fixed sequence may have since been captured by the opponent's real
// (not scripted) replies.
async function findAnySelectableCellIndex(page: Page, timeoutMs = 10000): Promise<number> {
  const cells = page.locator('[role="gridcell"]');
  const count = await cells.count();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (let i = 0; i < count; i++) {
      const cursor = await cells.nth(i).evaluate((el) => getComputedStyle(el).cursor);
      if (cursor === "pointer") return i;
    }
    await page.waitForTimeout(25);
  }
  throw new Error(`No selectable gridcell found within ${timeoutMs}ms`);
}

async function waitForAgentDone(page: Page, timeoutMs = 60000): Promise<void> {
  await page.waitForFunction(() => !document.body.innerText.includes("Agent thinking"), { timeout: timeoutMs });
  await page.waitForTimeout(200);
}

async function shot(page: Page, name: string): Promise<string> {
  const file = path.join(SHOT_DIR, name);
  await page.screenshot({ path: file });
  console.log(`saved ${name}`);
  return name;
}

async function isGameOver(page: Page): Promise<boolean> {
  return (await page.getByRole("button", { name: "New game" }).count()) > 0;
}

// ---------- Screenshot 1: mid-game, A piece selected, highlights visible ----------
async function screenshot1(browser: Browser) {
  // A hard-difficulty agent can legitimately win in just a few replies --
  // found for real, 6/6 attempts, all losing the same way (confirmed via
  // the server log: winner=B after its 3rd move every time). Not a timing
  // bug -- a real strategic flaw in the first move set: advancing 4 of 5
  // back-row pieces at once vacates 4 of 5 columns entirely, leaving every
  // one of them open for the agent to Surge straight down uncontested
  // (Surge twice + one standard step reaches row 0 in exactly 3 replies,
  // matching the observed loss exactly). This set advances only 3 pieces,
  // in non-adjacent columns, leaving the others as cover.
  const aMoves: [number, number, number, number][] = [
    [0, 0, 1, 0],
    [0, 2, 1, 2],
    [0, 4, 1, 4],
  ];
  const maxAttempts = 8;
  let page: Page | null = null;
  let succeeded = false;

  for (let attempt = 1; attempt <= maxAttempts && !succeeded; attempt++) {
    if (page) await page.context().close();
    page = await newContext(browser);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "vs AI" }).click();
    await page.getByRole("button", { name: "Hard" }).click();
    await page.getByRole("button", { name: "Start game" }).click();
    await page.locator('[role="grid"]').waitFor({ state: "visible", timeout: 10000 });
    await page.waitForTimeout(800);

    let wonEarly = false;
    for (const [fr, fc, tr, tc] of aMoves) {
      if (await isGameOver(page)) {
        wonEarly = true;
        break;
      }
      await waitForCellSelectable(page, fr, fc);
      await clickCell(page, fr, fc);
      await clickCell(page, tr, tc);
      await waitForAgentDone(page);
    }
    if (wonEarly || (await isGameOver(page))) {
      console.log(`Attempt ${attempt}: the agent won before all ${aMoves.length} A moves completed -- retrying with a fresh game.`);
      continue;
    }
    succeeded = true;
  }

  if (!page || !succeeded) {
    throw new Error(`screenshot1: agent won early in all ${maxAttempts} attempts -- could not reach the planned mid-game state.`);
  }

  // Confirm real game progress before treating this as "mid-game": count
  // how many distinct B-side squares differ from B's original full back row.
  const bPiecesMovedAway = await page.evaluate(() => {
    // The app doesn't expose raw board state globally; infer from the DOM
    // by checking how many of the 5 original B back-row visual cells (top
    // row, indices 0-4) still contain a piece.
    const cells = document.querySelectorAll('[role="gridcell"]');
    let stillThere = 0;
    for (let i = 0; i < 5; i++) {
      const rect = cells[i].getBoundingClientRect();
      const hasPiece = Array.from(document.querySelectorAll("div")).some((d) => {
        if (!getComputedStyle(d).backgroundImage.includes("radial-gradient")) return false;
        const r = d.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        return cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom;
      });
      if (hasPiece) stillThere++;
    }
    return 5 - stillThere;
  });
  console.log(`B pieces no longer on their original back-row squares: ${bPiecesMovedAway} (of 5)`);

  // Select whichever A piece is actually currently selectable, to show
  // highlights -- not a hardcoded square, which may have been captured
  // for real during the opponent's actual replies.
  const selectableIdx = await findAnySelectableCellIndex(page);
  await page.locator('[role="gridcell"]').nth(selectableIdx).click();
  await page.waitForTimeout(300);

  await shot(page, "screenshot1_midgame_selected.png");
  await page.context().close();
}

// ---------- Screenshot 2: Surge move made, exposed glow visible ----------
async function screenshot2(browser: Browser) {
  const page = await newContext(browser);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "vs AI" }).click();
  await page.getByRole("button", { name: "Hard" }).click();
  await page.getByRole("button", { name: "Start game" }).click();
  await page.locator('[role="grid"]').waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(800);

  // A's Surge move: (0,2) -> (2,2), a legal Surge on turn 1. Captured
  // immediately after, before the agent responds -- exposed is real game
  // state (state.exposed), not a transient animation, and stays set until
  // the agent's reply resolves, so there's no timing risk here.
  await waitForCellSelectable(page, 0, 2);
  await clickCell(page, 0, 2);
  await clickCell(page, 2, 2);

  // Confirm the real exposed glow is actually present, not assumed -- poll
  // rather than a fixed delay, since this machine has shown real variable
  // latency on the submitMove round-trip before (the optimistic UI shows
  // the piece moving immediately, but the *authoritative* exposed flag
  // only lands once setState(next) fires with the server's real response).
  // The exposed piece's ring uses boxShadow with --color-surge-charge.
  let exposedGlowPresent = false;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    exposedGlowPresent = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("div")).some((d) => {
        const bs = getComputedStyle(d).boxShadow;
        return bs.includes("177, 78, 255");
      });
    });
    if (exposedGlowPresent) break;
    await page.waitForTimeout(100);
  }
  console.log(`Exposed glow (surge-charge violet boxShadow) actually present: ${exposedGlowPresent}`);
  if (!exposedGlowPresent) {
    throw new Error("screenshot2: exposed glow never appeared within 8s -- not capturing a screenshot that doesn't show what it's supposed to.");
  }

  await shot(page, "screenshot2_surge_exposed.png");
  await page.context().close();
}

// ---------- Screenshot 3: win banner, mid-entrance-animation ----------
async function screenshot3(browser: Browser) {
  const page = await newContext(browser);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.getByText("Local 2-player", { exact: true }).click();
  await page.getByRole("button", { name: "Start game" }).click();
  await page.locator('[role="grid"]').waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(800);

  async function hotseatMove(fr: number, fc: number, tr: number, tc: number) {
    await waitForCellSelectable(page, fr, fc);
    await clickCell(page, fr, fc);
    await clickCell(page, tr, tc);
    await page.waitForTimeout(150);
  }

  async function handoff() {
    const btn = page.getByRole("button", { name: /I'm Player (A|B), go/ });
    if ((await btn.count()) > 0) {
      await btn.click();
      await page.waitForTimeout(200);
    }
  }

  // Deterministic 3-move win for A, verified against the real rules engine
  // (board.py/moves.py): Surge (0,2)->(2,2), Surge (2,2)->(4,2), then a
  // straight standard move (4,2)->(5,2) once B's two harmless replies have
  // cleared that square -- reaches B's back row, an instant win.
  await hotseatMove(0, 2, 2, 2); // A surge 1
  await handoff();
  await hotseatMove(5, 0, 4, 0); // B harmless
  await handoff();
  await hotseatMove(2, 2, 4, 2); // A surge 2
  await handoff();
  await hotseatMove(5, 2, 4, 1); // B clears (5,2) out of A's path
  await handoff();

  // Final, winning move.
  await waitForCellSelectable(page, 4, 2);
  await clickCell(page, 4, 2);
  await clickCell(page, 5, 2);

  // Wait for the banner to genuinely be visible -- not a fixed delay, and
  // not a fragile "catch the spring mid-flight" poll (a first attempt at
  // that found 0 panels within its 3s window in some real runs and fell
  // through to capturing the bannerless board, silently). The actual
  // requirement is the banner being on screen, not literally mid-animation.
  await page.getByRole("button", { name: "New game" }).waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(120); // still early in the spring settle, but guaranteed present

  const bannerVisible = (await page.getByRole("button", { name: "New game" }).count()) > 0;
  console.log(`Win banner ("New game" button) actually present before capture: ${bannerVisible}`);
  if (!bannerVisible) {
    throw new Error("screenshot3: win banner never appeared -- not capturing a screenshot that doesn't show it.");
  }

  await shot(page, "screenshot3_win_banner.png");
  await page.context().close();
}

// ---------- Screenshot 4: rules overlay open ----------
async function screenshot4(browser: Browser) {
  const page = await newContext(browser);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "vs AI" }).click();
  await page.getByRole("button", { name: "Hard" }).click();
  await page.getByRole("button", { name: "Start game" }).click();
  await page.locator('[role="grid"]').waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(800);

  await page.getByRole("button", { name: "Rules" }).click();
  await page.locator('[role="dialog"][aria-label="Surge rules"]').waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(400);

  await shot(page, "screenshot4_rules_overlay.png");
  await page.context().close();
}

async function main() {
  const browser = await chromium.launch({ channel: "chromium" });
  await screenshot1(browser);
  await screenshot2(browser);
  await screenshot3(browser);
  await screenshot4(browser);
  await browser.close();
  console.log("\nAll 4 screenshots captured.");
}

main().catch((e) => {
  console.error("Script crashed:", e);
  process.exit(1);
});
