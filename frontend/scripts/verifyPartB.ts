// Automated Part B verification via Playwright, run against the real
// running app (uvicorn on :8000, bun run dev on :8080). This is a
// verification script -- it measures real computed values and reports
// pass/fail, it does not patch anything it finds broken.
//
// Run with: node --experimental-strip-types scripts/verifyPartB.ts
// (NOT bun -- Playwright's pipe-based CDP transport doesn't complete its
// handshake under Bun on this machine; confirmed via a standalone repro
// that the identical chromium.launch() call succeeds in ~180ms under
// plain Node but times out after 180s under Bun. Not a check failure,
// an infrastructure incompatibility found and worked around.)
//
// Each check runs in its own try/catch with its own fresh browser context
// and its own fresh game. A timeout or exception in one check is recorded
// as a FAIL and the script moves on to the next check with a clean slate,
// rather than losing every remaining check the way the first version did.

import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = path.resolve(__dirname, "..", "..", "verification_screenshots");
mkdirSync(SHOT_DIR, { recursive: true });

const BASE_URL = "http://localhost:8080";
const COLS = 5;
const ROWS = 6;

type Report = { check: string; pass: boolean; detail: string; screenshots: string[] };
const results: Report[] = [];

function record(check: string, pass: boolean, detail: string, screenshots: string[]) {
  results.push({ check, pass, detail, screenshots });
  console.log(`\n[${pass ? "PASS" : "FAIL"}] ${check}`);
  console.log(detail);
  if (screenshots.length) console.log("screenshots: " + screenshots.join(", "));
}

function recordError(check: string, e: unknown) {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  record(check, false, `Threw/timed out instead of completing: ${msg}`, []);
}

// boardRow -> DOM index of its gridcell, given the flipRow visual transform
// (visualRow = ROWS-1-boardRow, cells laid out row-major in DOM order).
function domIndex(boardRow: number, boardCol: number): number {
  const visualRow = ROWS - 1 - boardRow;
  return visualRow * COLS + boardCol;
}

async function shot(page: Page, name: string): Promise<string> {
  const file = path.join(SHOT_DIR, name);
  await page.screenshot({ path: file });
  return name;
}

async function newVsAiHardGame(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Start game" }).click();
  await page.locator('[role="grid"]').waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(700); // let the initial-mount stagger settle
  return page;
}

async function newHotseatGame(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.getByText("Local 2-player", { exact: true }).click();
  await page.getByRole("button", { name: "Start game" }).click();
  await page.locator('[role="grid"]').waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(700);
  return page;
}

// Polls the real DOM (no fixed delay) until the given cell's computed
// cursor style is "pointer" -- per Board.tsx, that only happens once
// canSelect/legal_moves for this cell has actually arrived and been
// rendered, so this is a direct signal of "the click will land on a
// truly interactive cell" rather than guessing a delay is long enough.
async function waitForCellSelectable(page: Page, domIdx: number, timeoutMs = 10000): Promise<boolean> {
  const cell = page.locator('[role="gridcell"]').nth(domIdx);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cursor = await cell.evaluate((el) => getComputedStyle(el).cursor);
    if (cursor === "pointer") return true;
    await page.waitForTimeout(25);
  }
  return false;
}

// The browser normalizes an inline boxShadow string on readback (e.g.
// "inset 0 0 0 1.5px rgba(255,255,255,0.35)" comes back as
// "rgba(255, 255, 255, 0.35) 0px 0px 0px 1.5px inset") -- an exact-string
// match against the literal JSX value silently never matches, even though
// the ring is genuinely present (confirmed directly: a diagnostic probe
// found the ring's child element at the expected index every time, with
// exactly this reformatted string). Comparing against a throwaway probe
// element given the *same* literal value lets the browser do its own
// normalization on both sides, the same technique already used for the
// 3D tilt check.
async function findFocusRingIndex(page: Page, cellCount: number): Promise<number> {
  const normalizedFocusRing = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.boxShadow = "inset 0 0 0 1.5px rgba(255,255,255,0.35)";
    document.body.appendChild(probe);
    const v = probe.style.boxShadow;
    document.body.removeChild(probe);
    return v;
  });
  const cells = page.locator('[role="gridcell"]');
  for (let i = 0; i < cellCount; i++) {
    const hasRing = await cells.nth(i).evaluate(
      (el, expected) => Array.from(el.children).some((c) => (c as HTMLElement).style.boxShadow === expected),
      normalizedFocusRing,
    );
    if (hasRing) return i;
  }
  return -1;
}

// ---------- Check 1: Setup Screen on fresh load ----------
async function check1(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  const shot1 = await shot(page, "01_setup_screen.png");

  const hasStartButton = await page.getByRole("button", { name: "Start game" }).count();
  const hasVsAi = await page.getByText("vs AI", { exact: true }).count();
  const hasHotseatOption = await page.getByText("Local 2-player", { exact: true }).count();
  const hasBoard = await page.locator('[role="grid"]').count();

  const pass = hasStartButton > 0 && hasVsAi > 0 && hasHotseatOption > 0 && hasBoard === 0;
  record(
    "1. Setup Screen on fresh load",
    pass,
    `Start game button count=${hasStartButton}, "vs AI" count=${hasVsAi}, "Local 2-player" count=${hasHotseatOption}, board[role=grid] count=${hasBoard} (expected 0 -- board must not be present yet)`,
    [shot1],
  );
  await context.close();
}

// ---------- Check 2: 3D tilt actually applied ----------
async function check2(browser: Browser) {
  const page = await newVsAiHardGame(browser);
  const shot2 = await shot(page, "02_board_with_tilt.png");
  const grid = page.locator('[role="grid"]');
  const actualTransform = await grid.evaluate((el) => getComputedStyle(el).transform);

  const expectedTransform = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.transform = "perspective(1200px) rotateX(15deg)";
    document.body.appendChild(probe);
    const v = getComputedStyle(probe).transform;
    document.body.removeChild(probe);
    return v;
  });

  const pass = actualTransform !== "none" && actualTransform === expectedTransform;
  record(
    "2. 3D tilt actually applied",
    pass,
    `Board getComputedStyle(transform) = "${actualTransform}"\nExpected (browser-computed reference for perspective(1200px) rotateX(15deg)) = "${expectedTransform}"\nExact match: ${actualTransform === expectedTransform}`,
    [shot2],
  );
  await page.context().close();
}

// ---------- Check 3: agent-thinking visual state ----------
async function check3(browser: Browser) {
  const page = await newVsAiHardGame(browser);

  // A's first move: (0,0) -> (1,0), a guaranteed-legal standard move on
  // turn 1 regardless of agent behavior afterward.
  await page.locator('[role="gridcell"]').nth(domIndex(0, 0)).click();
  await page.locator('[role="gridcell"]').nth(domIndex(1, 0)).click();

  const grid = page.locator('[role="grid"]');
  const turnTextEl = page.getByText("TURN", { exact: true });

  let caughtOpacity: number | null = null;
  let caughtFilter: string | null = null;
  let shotMidThinking: string | null = null;
  const pollDeadline = Date.now() + 4000;
  while (Date.now() < pollDeadline) {
    const opacity = await grid.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
    if (Math.abs(opacity - 0.62) < 0.05) {
      caughtOpacity = opacity;
      caughtFilter = await turnTextEl.evaluate((el) => {
        const wrapper = el.closest("div")!;
        return getComputedStyle(wrapper).filter;
      });
      shotMidThinking = await shot(page, "03_agent_thinking_dimmed.png");
      break;
    }
    await page.waitForTimeout(15);
  }

  const pass = caughtOpacity !== null && caughtFilter !== null && caughtFilter.includes("drop-shadow");
  record(
    "3. Agent-thinking visual state",
    pass,
    caughtOpacity !== null
      ? `Caught board opacity = ${caughtOpacity} (expected ~0.62). Turn-indicator computed filter = "${caughtFilter}" (expected to contain drop-shadow).`
      : `Never observed board opacity near 0.62 within 4000ms of polling -- the agent's response was likely faster than this script's polling could catch, or the dim isn't actually applying. Could not confirm.`,
    shotMidThinking ? [shotMidThinking] : [],
  );

  // Regression check: confirm "Agent thinking..." is actually removed from
  // the DOM (not just that isAgentThinking flipped) within a real bound.
  // The backend agent has a 10s defensive search() cutoff, and the
  // Readout.tsx exit transition (previously inheriting repeat: Infinity
  // from the shared `transition` prop, which meant AnimatePresence's exit
  // never reported completion and the element never unmounted, regardless
  // of how fast the backend responded) now has its own finite 0.2s exit.
  // 13s covers both with margin, tight enough that a real regression in
  // either one fails this check instead of waiting it out.
  await page.waitForFunction(() => !document.body.innerText.includes("Agent thinking"), { timeout: 13000 });
  await page.context().close();
}

// ---------- Check 4: arrow key focus direction ----------
async function check4(browser: Browser) {
  const page = await newVsAiHardGame(browser);

  // Establish a known focus by clicking A's piece at board (0,2). Wait for
  // the cell to actually be selectable (cursor: pointer, driven by
  // canSelect/legal_moves having arrived) rather than a fixed delay --
  // a previous run found no focus ring at all, and a fixed 700ms wait
  // landing before legal_moves was populated is one real candidate cause.
  const fromIdx = domIndex(0, 2);
  const becameSelectable = await waitForCellSelectable(page, fromIdx);
  await page.locator('[role="gridcell"]').nth(fromIdx).click();
  const shotBefore = await shot(page, "04_focus_before_arrowup.png");

  const cellCount = await page.locator('[role="gridcell"]').count();
  const focusIdxBefore = await findFocusRingIndex(page, cellCount);

  await page.locator('[role="grid"]').focus();
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(100);
  const shotAfter = await shot(page, "04_focus_after_arrowup.png");

  const focusIdxAfter = await findFocusRingIndex(page, cellCount);

  const visualRowBefore = Math.floor(focusIdxBefore / COLS);
  const visualRowAfter = Math.floor(focusIdxAfter / COLS);
  const pass =
    focusIdxBefore === domIndex(0, 2) && focusIdxAfter === domIndex(1, 2) && visualRowAfter < visualRowBefore;

  record(
    "4. Arrow key focus direction",
    pass,
    `Cell became selectable (cursor:pointer, confirms legal_moves had arrived) before clicking: ${becameSelectable}.\nBefore ArrowUp: focus ring at gridcell DOM index ${focusIdxBefore} (expected ${domIndex(0, 2)} = board[0,2]), visual row ${visualRowBefore}.\nAfter ArrowUp: focus ring at gridcell DOM index ${focusIdxAfter} (expected ${domIndex(1, 2)} = board[1,2]), visual row ${visualRowAfter}.\nVisual row decreased (moved toward the top, where B renders): ${visualRowAfter < visualRowBefore}.\n${!pass && becameSelectable ? "Cell WAS confirmed selectable before the click, so this is not the timing race -- a real focus-handling issue." : ""}${!pass && !becameSelectable ? "Cell never became selectable within the wait window -- a real problem distinct from the original fixed-delay race." : ""}`,
    [shotBefore, shotAfter],
  );
  await page.context().close();
}

// ---------- Check 5: both Surge arcs, hotseat mode for full control ----------
async function surgeAndPoll(
  page: Page,
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number,
  label: string,
) {
  const fromIdx = domIndex(fromRow, fromCol);
  const toIdx = domIndex(toRow, toCol);

  // Wait for the real DOM signal that this cell is actually selectable
  // (canSelect/legal_moves has arrived) before doing anything else --
  // not a fixed delay. A previous run found a flat, dip-free B-side arc;
  // one real candidate cause is the click landing before B's legal moves
  // were ready, which a fixed delay can silently paper over or silently
  // miss depending on timing, rather than this script ever knowing for sure.
  const becameSelectable = await waitForCellSelectable(page, fromIdx);

  const result = await page.evaluate(
    async ({ fromIdx, toIdx }: { fromIdx: number; toIdx: number }) => {
      const cells = document.querySelectorAll('[role="gridcell"]');
      const fromCell = cells[fromIdx] as HTMLElement;
      const toCell = cells[toIdx] as HTMLElement;
      const fromRect = fromCell.getBoundingClientRect();

      const candidates = Array.from(document.querySelectorAll("div")).filter((d) =>
        getComputedStyle(d).backgroundImage.includes("radial-gradient"),
      );
      let target: HTMLElement | null = null;
      for (const c of candidates) {
        const r = c.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (cx >= fromRect.left && cx <= fromRect.right && cy >= fromRect.top && cy <= fromRect.bottom) {
          target = c as HTMLElement;
          break;
        }
      }
      if (!target) return { error: "piece not found at from-cell" };
      const outerEl = target.parentElement!.parentElement! as HTMLElement;

      fromCell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

      // Wait for the real "selected" ring to actually appear on fromCell
      // (Board.tsx's isSelected styling) instead of a fixed delay, so the
      // second click is only ever fired once selectedFrom has genuinely
      // updated -- if this never appears, that's reported explicitly
      // rather than silently clicking toCell anyway.
      let selectionConfirmed = false;
      const selectDeadline = performance.now() + 2000;
      while (performance.now() < selectDeadline) {
        const hasSelectedRing = Array.from(fromCell.children).some(
          (c) => (c as HTMLElement).style.boxShadow === "inset 0 0 0 1.5px var(--color-player-a)",
        );
        if (hasSelectedRing) {
          selectionConfirmed = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 15));
      }

      toCell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

      const samples: { t: number; transform: string }[] = [];
      const start = performance.now();
      while (performance.now() - start < 650) {
        samples.push({ t: performance.now() - start, transform: getComputedStyle(outerEl).transform });
        await new Promise((r) => setTimeout(r, 12));
      }
      return { samples, selectionConfirmed };
    },
    { fromIdx, toIdx },
  );

  if ("error" in result) {
    record(`5. Surge arc (${label})`, false, `In-page error: ${result.error}`, []);
    return;
  }

  const tys = result.samples.map((s) => {
    const m = s.transform.match(/matrix\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(",").map((x) => parseFloat(x.trim()));
    return parts[5]; // translateY
  });
  const validTys = tys.filter((v): v is number => v !== null && !Number.isNaN(v));
  const firstTy = validTys[0];
  const lastTy = validTys[validTys.length - 1];
  const minTy = Math.min(...validTys);
  const dipFromFirst = firstTy - minTy;
  const dipFromLast = lastTy - minTy;
  const pass = dipFromFirst > 4 && dipFromLast > 4;

  const shotName = await shot(page, `05_surge_${label}.png`);
  record(
    `5. Surge arc (${label})`,
    pass,
    `Cell selectable before click: ${becameSelectable}. Selection ring confirmed after first click: ${result.selectionConfirmed}.\nSampled ${validTys.length} real translateY values over ~650ms.\nfirst=${firstTy?.toFixed(2)}px, min=${minTy.toFixed(2)}px, last=${lastTy?.toFixed(2)}px.\nDip below first: ${dipFromFirst.toFixed(2)}px, dip below last: ${dipFromLast.toFixed(2)}px (need >4px on both to count as a real arc, not noise).\n${!pass && becameSelectable && result.selectionConfirmed ? "Selection was confirmed real before the second click, so this is not the timing race -- a genuine arc-rendering issue for this side." : ""}${!pass && (!becameSelectable || !result.selectionConfirmed) ? "Selection was NOT confirmed before the second click -- consistent with the timing-race theory, not yet a confirmed app bug." : ""}`,
    [shotName],
  );
}

async function check5(browser: Browser) {
  const page = await newHotseatGame(browser);

  // Turn 1 (A, board row 0 -> row 2, a legal Surge on turn 1).
  await surgeAndPoll(page, 0, 2, 2, 2, "A");

  // Hotseat: handoff overlay appears after every move.
  await page.getByRole("button", { name: /I'm Player B, go/ }).click();
  await page.waitForTimeout(200);

  // Turn 2 (B, board row 5 -> row 3, a legal Surge on B's first move).
  await surgeAndPoll(page, 5, 2, 3, 2, "B");

  await page.context().close();
}

async function main() {
  const browser = await chromium.launch({ channel: "chromium" });

  const checks: [string, (b: Browser) => Promise<void>][] = [
    ["1. Setup Screen on fresh load", check1],
    ["2. 3D tilt actually applied", check2],
    ["3. Agent-thinking visual state", check3],
    ["4. Arrow key focus direction", check4],
    ["5. Surge arcs (A and B)", check5],
  ];

  for (const [name, fn] of checks) {
    try {
      await fn(browser);
    } catch (e) {
      recordError(name, e);
    }
  }

  await browser.close();
  printFinalReport();
}

function printFinalReport() {
  console.log("\n\n========== FINAL REPORT ==========");
  for (const r of results) {
    console.log(`\n[${r.pass ? "PASS" : "FAIL"}] ${r.check}`);
    console.log(r.detail);
    if (r.screenshots.length) console.log("  screenshots: " + r.screenshots.join(", "));
  }
  const anyFail = results.some((r) => !r.pass);
  console.log(`\n${anyFail ? "AT LEAST ONE CHECK FAILED" : "ALL CHECKS PASSED"}`);
}

main().catch((e) => {
  console.error("Script crashed outside any individual check:", e);
  process.exit(1);
});
