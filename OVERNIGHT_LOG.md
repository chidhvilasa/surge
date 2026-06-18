# Surge — Overnight Completion Run Log

## Pre-flight: git status check

Checked whether this is already a git repository, as requested, before doing anything else.

Command:
```
cd "c:/Users/chidh/Downloads/Surge" && git status
```
Output:
```
fatal: not a git repository (or any of the parent directories): .git
```

**Result: this is NOT yet a git repository.** No `.git` directory exists anywhere in or above this path. Proceeding per Step 2's explicit ordering: `.gitignore` gets written and verified *before* `git init` and before any `git add`.

User separately stated they'd already connected git and pushed a project using "this." Checked: `gh` CLI is not installed on this machine at all. Git's global identity *is* configured (`user.name=chidhvilasa yepuri`, `user.email=chidhvilasa2004@gmail.com`), and several other unrelated repos under `Downloads/` (`ATLAS`, `ddos-mitigation-ml-blockchain`, `driver_intent_repo`, `SecOps-Parliament`, `sentinel-rag`) do have `.git` and a configured `origin` remote (e.g. `https://github.com/chidhvilasa/sentinel-rag.git`, `https://github.com/chidhvilasa/atlas.git`). So git-the-tool has been used before, just never inside this `Surge` folder specifically — confirmed no `.git` here. GitHub username for this account: `chidhvilasa`.

---

## Step 1: Promote the validated policy to production

### 1.1 Copy snapshot_5000.pkl over the production policy

Command:
```
cp scripts/benchmark_snapshots/snapshot_5000.pkl backend/agent/policy_store/mcts_policy.pkl
```
Output of `ls -la` after copy:
```
-rw-r--r-- 1 chidh 197609 507108997 Jun 18 04:28 backend/agent/policy_store/mcts_policy.pkl
```

### 1.2 Table-size verification — discrepancy found, root-caused, not glossed over

Expected per the benchmark CSV: snapshot_5000 should have 2,301,105 table entries. Actual, checked two ways:

```
$ python -c "...MCTSAgent(n_simulations=200)..."   # loads via the exact same construction main.py uses
table size after load, before any search(): 2281026
```
```
$ python -c "...load snapshot_5000.pkl directly vs the copied production file, then md5 both..."
table size loading snapshot_5000.pkl directly: 2281026
table size loading the copied production file: 2281026
md5 snapshot_5000.pkl: c6e181d64f156defda93a216d8a8056e
md5 production copy  : c6e181d64f156defda93a216d8a8056e
```

**The copy itself is correct** — byte-identical MD5 to the source snapshot. But the actual table size (2,281,026) does not match the CSV's recorded value (2,301,105). Root cause, found in `scripts/benchmark_snapshots.py` lines 95-117:

```python
snapshot_path = os.path.join(args.snapshot_dir, f"snapshot_{games_done}.pkl")
agent.policy_path = snapshot_path
agent.save()                                                    # <- table saved to disk HERE

win_rate = evaluate_snapshot(agent, args.eval_games, rng, args.max_turns)   # <- this calls agent.search() repeatedly against
                                                                              #    the random bot, which mutates agent.table
                                                                              #    via the normal MCTS backprop side effect
writer.writerow([games_done, f"{win_rate:.4f}", args.eval_games, len(agent.table)])   # <- table size logged HERE, AFTER eval mutated it
```

`agent.save()` runs before `evaluate_snapshot()`, but the table-size column is read after `evaluate_snapshot()` has already grown the table further (each of the 200 eval-vs-random games calls `agent.search()`, and `search()` always backpropagates into `self.table` as a side effect, regardless of whether it's "training" or "evaluation"). So every row in `scripts/benchmark_results.csv`, not just the 5000 row, logged a table size taken *after* that chunk's evaluation games had already inflated it past what was actually written to that chunk's `.pkl` file. The `.pkl` files themselves are legitimate and exactly reproduce what self-play training alone produced at that checkpoint — they're just smaller than the CSV's table_size column claims, by roughly one evaluation run's worth of entries (~20k in this case: 2,301,105 − 2,281,026 = 20,079).

**Conclusion: the production policy file is valid and correctly promoted (verified by direct reload + MD5 match), but its real table size is 2,281,026, not the 2,301,105 I previously reported.** That earlier number came from a logging-order bug in the benchmark script, not from any corruption in this copy step. Not fixing `benchmark_snapshots.py` as part of this run since it wasn't asked for here — flagging it as a known bug for later.

### 1.2b Server startup time — also flagged honestly

Loading `mcts_policy.pkl` directly (no server, just `MCTSAgent(...)`) exceeded a 2-minute timeout in an inline check and had to be moved to a background task. Measured cleanly afterward:

```
load time: 82.1s, table size: 2281026
```

**This is a real, notable cost of promoting the 5000-game policy to production: every `uvicorn` restart now takes ~82 seconds before the API is reachable**, since `agent = MCTSAgent(...)` runs at module-import time in `api/main.py`. Not something to silently accept without flagging -- if fast restarts matter operationally, that's a future tradeoff to revisit (e.g. lazy loading, a smaller production snapshot, or restructuring the table). Not fixing it now since it wasn't asked for here.

Live verification, with an actual wait long enough for the load (used a background poll for "Uvicorn running" in the log rather than guessing a sleep duration):

```
$ cat /tmp/uvicorn_step1.log
INFO:     Started server process [36132]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)

$ curl -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST http://127.0.0.1:8000/games
{"game_id":"d406b737-60aa-4e5b-8099-f11dbb009349","board":[["A","A","A","A","A"],[null,null,null,null,null],[null,null,null,null,null],[null,null,null,null,null],[null,null,null,null,null],["B","B","B","B","B"]],"current_player":"A","surge_tokens":{"A":3,"B":3},"exposed":null,"winner":null,"win_reason":null,"turn_number":1,"legal_moves":[... 17 legal moves ...]}
HTTP_STATUS:200
```

Server boots correctly with the new production policy and serves a fresh game. Stopped the server afterward (`kill`).

### 1.3 Full test suite, after promoting the policy

Also slow now for the same reason -- `test_api.py` imports `api.main`, which triggers the same ~82s load at collection time.

```
$ python -m pytest backend/tests/ -v
============================= test session starts =============================
platform win32 -- Python 3.12.10, pytest-9.1.0, pluggy-1.6.0 -- C:\Users\chidh\Downloads\Surge\.venv\Scripts\python.exe
cachedir: .pytest_cache
rootdir: C:\Users\chidh\Downloads\Surge
plugins: anyio-4.14.0
collecting ... collected 15 items

backend/tests/test_agent.py::test_agent_only_picks_legal_moves PASSED    [  6%]
backend/tests/test_agent.py::test_agent_completes_a_full_self_play_game PASSED [ 13%]
backend/tests/test_agent.py::test_policy_save_and_load_roundtrip PASSED  [ 20%]
backend/tests/test_api.py::test_start_game_returns_initial_state PASSED  [ 26%]
backend/tests/test_api.py::test_get_game_state_matches_started_game PASSED [ 33%]
backend/tests/test_api.py::test_submit_human_move_then_get_agent_move PASSED [ 40%]
backend/tests/test_api.py::test_illegal_move_is_rejected PASSED          [ 46%]
backend/tests/test_api.py::test_unknown_game_id_returns_404 PASSED       [ 53%]
backend/tests/test_api.py::test_finished_game_via_api_updates_saved_policy_file PASSED [ 60%]
backend/tests/test_rules_engine.py::test_normal_capture PASSED           [ 66%]
backend/tests/test_rules_engine.py::test_illegal_own_piece_blocking PASSED [ 73%]
backend/tests/test_rules_engine.py::test_surge_jump_over_occupied_intermediate PASSED [ 80%]
backend/tests/test_rules_engine.py::test_exposed_capture_from_sideways_and_backward_directions PASSED [ 86%]
backend/tests/test_rules_engine.py::test_one_surge_per_turn_limit PASSED [ 93%]
backend/tests/test_rules_engine.py::test_no_legal_moves_loss_condition PASSED [100%]
```

All 15 passed. Process confirmed exited afterward (checked via `ps`, no longer present).

**Step 1 status: done, with two honest caveats logged above (table-size logging bug in the benchmark script meant the real number is 2,281,026 not 2,301,105; and the promoted policy adds ~82s to every server/test-suite startup).**

---

## Step 2: .gitignore, before git init / git add

Done in this exact order, per the brief.

### 2.1 Wrote .gitignore before git init

Initial `.gitignore` already existed from earlier in the project but was missing the required `*.pkl` rule entirely (it had a stale `backend/agent/policy_store/*.json` pattern that never matched anything, since the policy store only ever produced `.pkl` files) and was missing `scripts/benchmark_snapshots/`. Replaced with:

```
.venv/
venv/
env/
.claude/
__pycache__/
*.pyc
.pytest_cache/
*.egg-info/
.DS_Store
*.log
node_modules/
frontend/node_modules/
dist/
frontend/dist/
build/
backend/agent/policy_store/*.pkl
!backend/agent/policy_store/.gitkeep
scripts/benchmark_snapshots/
```

(`.claude/` added beyond the requested list — see below.)

### 2.2 `git init`

```
$ git init
Initialized empty Git repository in C:/Users/chidh/Downloads/Surge/.git/
```

### 2.3 First git status — caught a problem before staging

```
$ git status
On branch master

No commits yet

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	.claude/
	.gitignore
	OVERNIGHT_LOG.md
	README.md
	backend/
	docs/
	frontend/
	requirements.txt
	scripts/

nothing added to commit but untracked files present (use "git add" to track)
```

`.claude/` showed up — local Claude Code tool state, not part of the project. Checked its contents:
```
$ find .claude -maxdepth 3
.claude
.claude/scheduled_tasks.lock
```
Just a lock file for this tool's own scheduled-task tracking. Added `.claude/` to `.gitignore` before staging anything (already included in the listing above).

### 2.4 Full dry-run check before any real `git add`

`git status` alone collapses a wholly-untracked directory into one line (e.g. just "frontend/"), which isn't a real per-file visual check. Used `git add --dry-run -A .` instead, which lists every individual file that would be staged, then grepped that list for the dangerous patterns:

```
$ git add --dry-run -A . > /tmp/dry_run_add.txt
$ wc -l /tmp/dry_run_add.txt
114 /tmp/dry_run_add.txt
$ grep -i "\.pkl" /tmp/dry_run_add.txt        -> (no output)
$ grep -i "node_modules" /tmp/dry_run_add.txt -> (no output)
$ grep -i "\.venv" /tmp/dry_run_add.txt       -> (no output)
$ grep -i "\.claude" /tmp/dry_run_add.txt     -> (no output)
$ grep -i "benchmark_snapshots/" /tmp/dry_run_add.txt -> (no output)
$ grep -i "benchmark_results.csv\|training_log.csv\|human_game_updates.csv" /tmp/dry_run_add.txt
add 'backend/agent/policy_store/training_log.csv'
add 'scripts/benchmark_results.csv'
```

`human_game_updates.csv` doesn't appear because that file doesn't exist on disk yet (no real human-vs-agent game has been played through the live API since the earlier contamination cleanup) -- confirmed via `ls`, not a `.gitignore` bug. The `.gitignore` pattern only excludes `*.pkl` in that directory, so the CSV will be picked up automatically once it's created.

Clean. Then staged for real and re-checked:

```
$ git add -A .
$ git status
On branch master
No commits yet
Changes to be committed: [114 files, all source/docs/config/small CSVs]
```

Total size and largest files, to catch anything oversized that individual grep checks might miss:
```
$ git ls-files -s | ... | awk '{sum+=$1} END {print sum/1024/1024 " MB total"}'
0.466275 MB total

$ git ls-files | xargs -I{} du -b "{}" | sort -rn | head -10
181283	frontend/bun.lock
23975	frontend/src/components/ui/sidebar.tsx
11260	frontend/.lovable/plan.md
10570	frontend/src/components/ui/chart.tsx
10503	backend/agent/policy_store/training_log.csv
10228	frontend/src/components/surge/Board.tsx
8546	frontend/src/components/ui/menubar.tsx
8128	frontend/src/lib/surge/mock.ts
7596	frontend/src/components/ui/dropdown-menu.tsx
7391	frontend/src/components/ui/context-menu.tsx
```

Total staged content is well under half a megabyte. Largest file is the Bun lockfile at 181KB. Confirmed clean -- no `.pkl`, no `node_modules/`, no `.venv/`, no `.claude/`, no benchmark snapshot directory.

(Not committing yet -- that's Step 5, after Steps 3 and 4.)

---

## Step 3: Wire the frontend to the real backend

### 3.1 CORS middleware

Added to `backend/api/main.py`:
```python
from fastapi.middleware.cors import CORSMiddleware
...
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080"],
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 3.2 client.ts -- found a real contract mismatch, not just a flag flip

Before touching `USE_MOCK`, checked what `frontend/src/lib/surge/client.ts` actually calls. It was built against an imagined API shape that doesn't match our real backend at all:

| client.ts called | real backend route |
|---|---|
| `POST /create-game` | `POST /games` |
| `POST /submit-move` with `{game_id, move}` body | `POST /games/{game_id}/move` with the move fields directly |
| `POST /agent-move` with `{game_id}` body | `POST /games/{game_id}/agent-move`, no body |

Just flipping `USE_MOCK = false` would have produced 404s on every call. Fixed the endpoint paths and request bodies in `client.ts` to match `backend/api/main.py` exactly, set `USE_MOCK = false`, and set the `API_BASE_URL` default to `http://localhost:8000` (still overridable via `VITE_SURGE_API_BASE_URL`).

Also found, while checking the response shapes against `frontend/src/lib/surge/types.ts`:
- `MoveType` only had `standard_move | surge_move | exposed_capture` -- missing `standard_capture` and `surge_capture`, which the real backend produces for every capture move.
- `WinReason` only had `breakthrough | elimination | stalemate` -- the real backend's values are `back_row | elimination | no_legal_moves`.

These map 1:1 onto the same underlying concepts the mock used (reaching the back row = breakthrough, opponent has zero legal moves = stalemate), so widened both type unions to include the real values, and added matching entries to the two places that branch on these specific strings (`WinBanner.tsx`'s `REASON_LABEL` map, `MoveTypeBadge.tsx`'s `LABELS` map + surge-color condition), reusing the existing label text for the equivalent concept rather than inventing new wording. Flagging this clearly: the exact display copy and whether captures deserve different wording than non-captures is a content/UX call for a human to revisit, not something to silently lock in -- left a comment in both files saying so.

Verified clean afterward:
```
$ bunx tsc --noEmit
(no output -- no errors)
```

### 3.3 Running both servers and verifying the connection

Started `uvicorn` (port 8000) and `bun run dev` (frontend) in the background. Two real problems surfaced and were fixed before the actual verification:

1. **A uvicorn process from Step 1's verification was still alive** despite an earlier `kill` on its parent PID -- the `python -m uvicorn` wrapper process died, but the actual worker process (`python3.12.exe`, PID 36132) survived independently on Windows. Found it still answering on port 8000 with the pre-CORS code. Killed it for real with `taskkill //PID 36132 //F`, confirmed via a refused connection, then started a fresh instance with the CORS-enabled code.

2. **The frontend did not start on port 8080** -- its own log said `Port 8080 is in use, trying another one...` and it bound to 8081 instead. This is exactly the kind of thing the brief said to confirm rather than assume. Checked what was squatting on 8080:
   ```
   $ netstat -ano | grep ":8080"
   TCP    0.0.0.0:8080   0.0.0.0:0   LISTENING   9068
   $ tasklist //FI "PID eq 9068"
   node.exe   9068
   ```
   A leftover `node.exe` from an earlier `bun run dev` I'd started in this same conversation (same pattern as #1 -- a backgrounded dev-server process whose parent shell PID was killed without actually killing the underlying process tree on Windows). Killed it (`taskkill //PID 9068 //F`), confirmed the port was free, and restarted the frontend, which then correctly bound to `localhost:8080`.

With both servers correctly up and the right ports confirmed, ran the actual verification:

```
$ curl -s -i -X OPTIONS http://127.0.0.1:8000/games \
  -H "Origin: http://localhost:8080" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
HTTP/1.1 200 OK
date: Wed, 17 Jun 2026 23:58:30 GMT
server: uvicorn
vary: Origin
access-control-allow-methods: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT
access-control-max-age: 600
access-control-allow-origin: http://localhost:8080
access-control-allow-headers: content-type
content-length: 2
content-type: text/plain; charset=utf-8

OK

$ curl -s -i -X POST http://127.0.0.1:8000/games \
  -H "Origin: http://localhost:8080"
HTTP/1.1 200 OK
date: Wed, 17 Jun 2026 23:58:30 GMT
server: uvicorn
content-length: 1442
content-type: application/json
access-control-allow-origin: http://localhost:8080
vary: Origin

{"game_id":"c78eeb0e-dc9d-42d9-9589-3d1e1e640010","board":[...],"current_player":"A","surge_tokens":{"A":3,"B":3},"exposed":null,"winner":null,"win_reason":null,"turn_number":1,"legal_moves":[... 18 legal moves ...]}
```

Both correct: the preflight gets the right `access-control-allow-origin` and `access-control-allow-headers`, and a real `POST /games` from the frontend's actual origin succeeds with valid game state.

### 3.4 Headless browser smoke check -- not attempted, and here's exactly why

Checked what was actually available without installing anything:
```
$ bunx playwright --version
Resolving dependencies
Resolved, downloaded and extracted [9]
Saved lockfile
```
This wasn't a "already available" hit -- `bunx` silently fetched playwright's package on demand. Confirmed it didn't touch the project (`git diff frontend/package.json frontend/bun.lock` is empty, so nothing got added as a real dependency), but actually using Playwright for a browser smoke check would additionally require `playwright install chromium` -- a real, sizeable download of browser binaries, not something already sitting on this machine.
```
$ which chrome chromium chromium-browser msedge   -> none found
$ npm ls -g playwright puppeteer                  -> empty
```
**No headless browser tool was trivially available. Per the explicit instruction not to spend time installing one, skipping the automated smoke check entirely.** The actual page-load-and-click verification, the animations, and the gameplay feel all still need a real human looking at a real browser in the morning -- nothing above substitutes for that, it only proves the network plumbing between the two servers is correct.

---

