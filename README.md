# Skyforge

**A Claude Code skill that delegates your prompts across multiple AI agents.**

Skyforge lets you work from a single chat window while your prompts get delegated to sub-agents, all overseen by one manager, making it a simpler way to get work done rather than switching windows every few seconds. Just keep feeding the manager tasks, and it delegates to sub-agents like a factory floor.

> You speak in tasks. It runs the shop, and answers in a single line when the work is done.

## How it works

Three roles, one calm loop:

- **Manager**: the main conversation. Owns intake, task breakdown, dispatch,
  monitoring, and reporting. It never does the task work itself; it only
  coordinates, so nothing moves without your approval.
- **Workers**: background agents (`skyforge-worker`), one task apiece, carried
  end to end and returned as a structured completion report. When you spin up
  Skyforge you choose how they share the repository: **guardrail** mode queues
  any task whose files overlap a running task (workers edit the tree directly),
  while **worktree** mode gives each file-editing task its own isolated git
  worktree, so nothing ever collides and you review each diff before it lands.
- **Board**: a durable ledger at `.skyforge/board.json` in the current
  repository, written only through `scripts/board.mjs`. It survives restarts, so
  the shop always remembers where it stood.

Every task on the line lives in exactly one of five states: `queued`, `running`,
`done`, `blocked`, `failed`. A sixth, `proposed`, is the **backlog**: follow-ups
the workers suggested, parked and never dispatched until you promote one.

While a task runs, its worker posts a one-line progress update at each milestone
— so a fifteen-minute job shows movement on the board instead of a frozen row.

## Install

**Just ask your AI.** In Claude Code (or any coding agent), say:

> Please install this skill: https://github.com/Andrew2142/Skyforge

The agent reads this page and runs the one-line installer below. That's it.

**Or run it yourself:**

```sh
curl -fsSL https://raw.githubusercontent.com/Andrew2142/Skyforge/main/install.sh | bash
```

The installer copies the skill to `~/.claude/skills/skyforge/` and the worker
agent to `~/.claude/agents/skyforge-worker.md` (it honours `$CLAUDE_CONFIG_DIR`
if you've set one). Start a new Claude Code session afterwards so it loads, then
say **"spin up the factory"**.

<details>
<summary>Manual install</summary>

```sh
git clone https://github.com/Andrew2142/Skyforge.git && cd Skyforge
mkdir -p ~/.claude/skills/skyforge ~/.claude/agents
cp -r SKILL.md references scripts ~/.claude/skills/skyforge/
cp agents/skyforge-worker.md ~/.claude/agents/
```
</details>

## Staying up to date

Skyforge updates itself. The first time you spin it up each day it checks this
repo, and if `main` has moved it pulls the new skill, scripts, and worker agent
into place — then tells you to restart the session so the new instructions load.

It is built to stay out of your way: the check is throttled to once every 24
hours, times out after 5 seconds, and never fails a spin-up — if you are offline
it says so in one line and the factory starts anyway. Files are fetched pinned to
one commit and written only once **all** of them download cleanly, so a dropped
connection can never leave you half-updated. **Any file you have edited yourself
is kept, not overwritten** — it says which, and `--overwrite-local` is how you
opt in to replacing it.

Run it yourself any time:

```sh
node ~/.claude/skills/skyforge/scripts/update.mjs --check   # what would change?
node ~/.claude/skills/skyforge/scripts/update.mjs --force   # update now
```

What is installed is recorded in `~/.claude/.skyforge-update.json`.

## Use

Trigger it in natural language. The manager listens for intent, not exact words:

- `skyforge`
- `delegate this to the team`
- `spin up the factory`
- `how's the factory doing?`

The **first** time you spin it up in a chat, Skyforge asks three quick toggles:

- **Auto mode** — on: dispatch automatically without waiting for your approval; off: propose a breakdown and wait for your go-ahead first.
- **Worktree isolation** — on: each file-editing task runs in its own git worktree; off: guardrail mode (workers edit the tree directly, with file-overlap queueing).
- **Verification** — on: workers build and test their work before reporting; off: type-check only — no build, no test suite, no browser — so tasks land sooner and you check the result yourself. Workers say what they skipped either way.

After that it stays engaged for the rest of the session — every task you hand over
is delegated to a worker, no need to remind it. Ask for status any time
(`how's the factory?`) to get a grouped report of what's running, blocked, and
ready for review, plus a link to the live board.

## The live board

`scripts/dashboard.mjs` serves a themed, auto-refreshing list of every task at
`http://localhost:4788` — one row per task, sorted running → queued → done, with
status pills, agent ids, one-line summaries, and each queued task's blocker.
Each running worker's live progress line sits under its row, and proposed
follow-ups collect in a **Backlog** section below the line. It reads
`.skyforge/board.json` and never writes it, so it can run alongside the manager
without touching the ledger.

```sh
node ~/.claude/skills/skyforge/scripts/dashboard.mjs   # SKYFORGE_DASH_PORT to override 4788
```

Ask for status and the manager starts it for you and hands over the URL.

## Repository layout

```
install.sh                one-line installer (clones + copies into ~/.claude)
SKILL.md                  the skill definition (the manager's operating loop)
references/protocol.md    board schema, worker-prompt template, report format, edge cases
scripts/board.mjs         the ledger CLI, the only writer of .skyforge/board.json
scripts/dashboard.mjs     read-only live board served at http://localhost:4788
scripts/update.mjs        daily self-updater; keeps locally-edited files
agents/skyforge-worker.md the background worker subagent, its execution discipline + report format
docs/index.html           a standalone landing page describing the skill
```

## The board CLI

`scripts/board.mjs` is the single source of truth for the ledger. Quick reference:

| Command | Purpose |
|---|---|
| `node board.mjs init [--mode worktree\|guardrail] [--auto on\|off] [--verify on\|off]` | Create `.skyforge/board.json` + `tasks/` (idempotent); sets mode + auto + verify |
| `node board.mjs mode [--set worktree\|guardrail]` | Show or change the concurrency mode |
| `node board.mjs auto [--set on\|off]` | Show or change auto mode (dispatch without approval) |
| `node board.mjs verify [--set on\|off]` | Show or change verification (on = build + tests; off = type-check only) |
| `node board.mjs add --title "..." [--parent T-00N] [--brief "..."] [--files "src/area"] [--blocked-by "T-00N"] [--from T-00N]` | Add a task; prints its id. `--blocked-by` = run-after dependency ids; `--from` files it on the backlog as a follow-up of that task |
| `node board.mjs set <id> --status <s> [--agent <id>] [--summary "..."] [--files "..."] [--blocked-by "..."]` | Update a task (`--blocked-by ""` clears the dependency) |
| `node board.mjs progress <id> "..."` | The worker's current-activity line, shown live on the board (replaces the previous one) |
| `node board.mjs promote <id> [<id>...]` | Backlog → queued. Yours to run; the manager never promotes for you |
| `node board.mjs ready` | Queued tasks safe to dispatch now (mode-aware); reports each held task's blocker(s). Never returns backlog tasks |
| `node board.mjs list [--status <s>]` | Compact task table |
| `node board.mjs get <id>` | Full JSON for one task |
| `node board.mjs note <id> "text"` | Append text to the task's brief file |
| `node board.mjs report` | Grouped human-readable status |

Mutating commands take a short-lived lock on `.skyforge/board.lock`, so parallel
calls (a batch of dispatches, workers posting progress) can't lose each other's
writes. Set `SKYFORGE_ROOT=<project root>` to reach the ledger from another
working directory — a worker inside an isolated worktree needs this.

Requires Node.js (uses only built-in modules, no dependencies).
