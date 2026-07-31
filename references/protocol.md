# Skyforge protocol reference

Detailed material kept out of SKILL.md: the board schema, the worker-prompt template, the completion-report format, and edge cases.

## Board schema (`.skyforge/board.json`)

```json
{
  "version": 1,
  "seq": 3,
  "createdAt": "2026-07-13T11:00:00.000Z",
  "mode": "guardrail",
  "auto": false,
  "tasks": [
    {
      "id": "T-001",
      "title": "Add rate limiting to the login endpoint",
      "assignee": "skyforge-worker",
      "agentId": "ad7f0c42fc1862060",
      "status": "running",
      "parent": null,
      "origin": null,
      "files": ["src/api/login.ts"],
      "blockedBy": [],
      "createdAt": "2026-07-13T11:00:01.000Z",
      "updatedAt": "2026-07-13T11:02:10.000Z",
      "progress": "mapped 6 call sites, adding the token-bucket middleware",
      "progressAt": "2026-07-13T11:02:10.000Z",
      "resultSummary": ""
    }
  ]
}
```

- `seq` is a monotonic counter; ids are `T-` + zero-padded seq. Never reused.
- `agentId` is the Agent-tool id of the worker — used to continue a worker via SendMessage.
- `status` is one of `proposed | queued | running | done | failed | blocked`.
- `parent` groups subtasks split from one larger request.
- `origin` is the task that proposed this one (set by `add --from`); `null` for user-originated work.
- `progress` / `progressAt` are the worker's current-activity line and when it was posted — written by the worker itself with `board.mjs progress`. A single line, replaced on each call, not a log. Cleared automatically when a task (re-)enters `running`, so a re-dispatch never shows the previous attempt's activity.
- `mode` (board-level) is `worktree` or `guardrail`; see **Concurrency modes** below. A board written before modes existed is read as `worktree`.
- `auto` (board-level): when true, the manager dispatches without waiting for approval. Set at init (`--auto on`) or with `board.mjs auto --set on|off`.
- `files` are the paths a task declares it will create or edit; used for overlap gating in `guardrail` mode, ignored in `worktree` mode.
- `blockedBy` lists task ids this task explicitly waits on — a **run-after dependency**, independent of file overlap. It stays out of `ready` until every listed id is `done`, in *both* modes. Absent/empty means no dependency. Set with `--blocked-by` on `add`/`set` (`--blocked-by ""` clears it).
- Task goals and final reports live in `.skyforge/tasks/<id>.md`, not in the JSON (keeps the JSON small and the reports readable).
- `board.mjs` serialises every mutation behind a `.skyforge/board.lock` directory, because several processes really do write at once (a batch of dispatch updates in one message, workers posting progress). Read-only commands (`list`, `get`, `ready`, `report`) skip the lock. A lock left by a killed process is reaped after 30s; if a command ever reports the board as locked, no write was lost — retry it.
- The ledger is found relative to the current directory. A worker running in an isolated **worktree** has a different cwd, so it must set `SKYFORGE_ROOT=<project root>` to reach the real board — the manager bakes this into the progress command it hands over (see the worker-prompt template).
- A read-only live viewer of this board is available separately: `scripts/dashboard.mjs` serves a themed task **list** at `http://localhost:4788` that auto-polls `board.json`. It only ever reads the board — `board.mjs` remains its sole writer.

## Concurrency modes

The board's `mode` decides how the manager dispatches file-editing work.

**`worktree`**: each file-editing task is launched with `isolation: "worktree"`, editing an isolated copy of the repo. Workers never collide, changes stay quarantined for review, and nothing is auto-merged. `board.mjs ready` returns every queued task (the Agent tool's own concurrency cap is the only limiter).

**`guardrail`**: workers edit the working tree directly, so the manager must stop two workers writing the same file at once. Each file-editing task declares its target paths (`--files`). `board.mjs ready` returns a safe batch: it walks the queue in order and includes a task only if its files overlap neither a `running` task nor another task already chosen in the batch. Overlap is by path: two paths conflict when equal, or when one is a directory containing the other (`src/api` conflicts with `src/api/login.ts`). Read-only tasks declare no files and are always safe. When a running task completes it frees its files; re-run `ready` to release newly-safe queued tasks.

**Dependencies & why a task waits.** Beyond file overlap, a task can declare an explicit run-after dependency with `--blocked-by "T-00N"`: it stays queued until every listed id is `done`, in *both* modes. `board.mjs ready` reports every queued task as either `READY` or `BLOCKED`, and `report` adds a `⤷ waiting on:` line — each names the specific blocker (the dependency id, or the running/selected task id whose area conflicts). The manager states *why* a task waits straight from that output rather than reconstructing it.

Set or read the mode with `board.mjs mode [--set <mode>]`.

## Backlog (`proposed` tasks)

Every worker returns FOLLOW-UPS. They are filed on the board immediately rather than remembered:

```
board.mjs add --title "Backfill tests for the rate limiter" --from T-001
```

`--from` records which task proposed it and implies `--proposed`, so the task lands with status `proposed`. A `proposed` task is **backlog, not work**: `ready` never returns it, no worker is ever dispatched for it, and it sits outside the running/queued line on both `report` and the dashboard. It becomes real work only when the user promotes it:

```
board.mjs promote T-005 [T-006 ...]     # proposed -> queued
```

Promoting only changes the status; from there the normal gates apply (file overlap, dependencies), so a promoted task still waits its turn. Promotion is the user's call — never promote a follow-up on their behalf, and never dispatch straight from the backlog.

## Worker-prompt template

Keep the brief **thin** — the manager does not investigate the codebase or design the approach; the worker does. Hand over the goal in the user's words and get out of the way:

```
You are Skyforge worker for task <ID>: <TITLE>.

## Goal
<the user's request, in their own words — one or two lines>

## Area (guardrail mode only)
Stay within: <coarse path, e.g. src/public-sites/.../notifications>.
Work out the exact files yourself; do not edit outside this area.

## Your job
Plan your own approach, then execute it end-to-end and verify it. Locating
files, choosing the design, and breaking the work into steps are all yours —
that is why this brief is thin.

## Progress
Post a one-line progress update as soon as you have a plan, and again as each
milestone lands — the user watches these on the live board:

  SKYFORGE_ROOT=<abs project root> node <abs path>/board.mjs progress <ID> "what you are doing right now"

Keep it short and present-tense. Each call replaces the last, so it is a
current-activity marker, not a log. Post one before any long-running step so
the board never looks stalled.

## If you hit a real question
If an ambiguity would change the outcome, stop early and return
`STATUS: blocked` with the one specific question you need answered — do not
guess. The manager relays it to the user and continues you (via SendMessage)
once answered. Keep going without asking for reversible, in-scope decisions.

## Reporting
Return your final answer in the Skyforge completion-report format
(STATUS / PLAN / SUMMARY / ARTIFACTS / VERIFICATION / FOLLOW-UPS / BLOCKERS).
Your final message IS the report — no preamble.
```

Launch options:
- `worktree` mode, file-editing task → Agent tool with `isolation: "worktree"`.
- `guardrail` mode, file-editing task → no isolation; the worker edits the working tree, so dispatch only when `board.mjs ready` clears it, and tell the worker to stay within its declared **coarse area** (it resolves the exact files itself).
- Read-only research task → no isolation, in either mode.
- Always `subagent_type: "skyforge-worker"`.
- Always set the Agent tool `description` to `T-00N <2–4 word label>` (e.g. `T-003 payment settlement fixes`). This is the worker's display name in the UI and completion notifications, so it MUST start with the task id — keep the same id on re-dispatch; do not prefix "Resume …" or drop the id.
- Launch independent workers in one message (concurrent). Concurrency is capped by the Agent tool; excess workers queue — leave those board entries `queued` and note it to the user.

## Completion-report format

Workers return exactly these sections. The manager parses them into the board.

```
STATUS: done | failed | blocked
PLAN: <the approach the worker chose and the files/area it decided to touch — 1–3 lines, so the user can see where and how the work was done>
SUMMARY: <2–4 sentences on what was accomplished>
ARTIFACTS: <files created/changed with paths; worktree name if isolated; or "none (research)">
VERIFICATION: <how it was checked — tests run, build, manual reasoning — with outcomes>
FOLLOW-UPS: <suggested next tasks, or "none">
BLOCKERS: <what stopped completion and what input is needed, or "none">
```

Map to the board:
- `STATUS: done` → `set <id> --status done --summary "<SUMMARY, trimmed>"`
- `STATUS: failed` → `set <id> --status failed --summary "<why>"`
- `STATUS: blocked` → `set <id> --status blocked --summary "<what's needed>"`, then relay the BLOCKERS question to the user right away (SKILL.md step 4).
- Always append the full report with `note <id> "..."` before setting status. PLAN is captured there for the user to review.
- **File every concrete FOLLOW-UP on the backlog immediately**, in the same breath as closing the task — one `add --title "<the follow-up>" --from <id>` per item. Do this before reporting the completion line, so nothing depends on remembering it later in the session. Then tell the user how many landed (e.g. `+2 to backlog`) rather than listing them; the board and dashboard hold the detail. Never dispatch a follow-up — only the user promotes.

## Edge cases

**Worker died / terminal error.** The Agent tool returns null or an error notification. Set the task `failed` with a summary of the error and offer to re-dispatch (optionally with a narrower brief).

**Blocked task.** Do not spin the worker in a loop. Mark `blocked`, capture the exact question in the summary, and surface it to the user. Resume by re-dispatching once the user answers, or continue the same worker via SendMessage if it is still alive.

**Session-restart recovery.** On a new session with an existing board: run `report`. Every `running` task is orphaned (its worker is gone). Present them and offer re-dispatch. Never report an orphaned `running` task as if it were live.

**Concurrency backpressure.** If more tasks are approved than can run at once, dispatch what fits, leave the rest `queued`, and tell the user how many are waiting. As workers finish, dispatch queued tasks.

**Worktree review (`worktree` mode).** A worktree task's changes stay in an isolated worktree until the user reviews. Report the diff summary and the worktree location; never merge without approval.

**File conflict (`guardrail` mode).** When `board.mjs ready` returns nothing but tasks are queued, every queued task overlaps running work — expected backpressure. Wait for a running task to finish, then re-run `ready`. If two approved tasks fundamentally need the same files, they cannot run in parallel in guardrail mode; run them in sequence, or suggest worktree mode.

**Multiple projects.** The board is per-cwd (`.skyforge/` in the working directory). Running the factory from a different repo uses a separate board — this is intentional.
