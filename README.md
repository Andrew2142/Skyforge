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

Every task lives in exactly one of five states: `queued`, `running`, `done`,
`blocked`, `failed`.

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

## Use

Trigger it in natural language. The manager listens for intent, not exact words:

- `skyforge`
- `delegate this to the team`
- `spin up the factory`
- `how's the factory doing?`

The **first** time you spin it up in a chat, Skyforge asks two quick toggles:

- **Auto mode** — on: dispatch automatically without waiting for your approval; off: propose a breakdown and wait for your go-ahead first.
- **Worktree isolation** — on: each file-editing task runs in its own git worktree; off: guardrail mode (workers edit the tree directly, with file-overlap queueing).

After that it stays engaged for the rest of the session — every task you hand over
is delegated to a worker, no need to remind it. Ask for status any time
(`how's the factory?`) to get a grouped report of what's running, blocked, and
ready for review.

## Repository layout

```
install.sh                one-line installer (clones + copies into ~/.claude)
SKILL.md                  the skill definition (the manager's operating loop)
references/protocol.md    board schema, worker-prompt template, report format, edge cases
scripts/board.mjs         the ledger CLI, the only writer of .skyforge/board.json
agents/skyforge-worker.md the background worker subagent + its completion-report format
docs/index.html           a standalone landing page describing the skill
```

## The board CLI

`scripts/board.mjs` is the single source of truth for the ledger. Quick reference:

| Command | Purpose |
|---|---|
| `node board.mjs init [--mode worktree\|guardrail]` | Create `.skyforge/board.json` + `tasks/` (idempotent); sets the mode |
| `node board.mjs mode [--set worktree\|guardrail]` | Show or change the concurrency mode |
| `node board.mjs add --title "..." [--parent T-00N] [--brief "..."] [--files "a.ts,src/api"]` | Add a task; prints its id |
| `node board.mjs set <id> --status <s> [--agent <id>] [--summary "..."] [--files "..."]` | Update a task |
| `node board.mjs ready` | Queued tasks safe to dispatch now (mode-aware) |
| `node board.mjs list [--status <s>]` | Compact task table |
| `node board.mjs get <id>` | Full JSON for one task |
| `node board.mjs note <id> "text"` | Append text to the task's brief file |
| `node board.mjs report` | Grouped human-readable status |

Requires Node.js (uses only built-in modules, no dependencies).
