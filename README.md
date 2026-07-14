# Skyforge

**A Claude Code skill that turns your assistant into the calm manager of a small shop of AI workers.**

You hand over the work. Instead of doing it in the chat, Skyforge breaks the
work into tasks, dispatches each one to a background worker agent, and keeps the
whole shop on a durable board you can trust. Workers run while you keep feeding
in more — the factory never has to drain before it will take the next request.

> You speak in tasks. It runs the shop, and answers in a single line when the work is done.

## How it works

Three roles, one calm loop:

- **Manager** — the main conversation. Owns intake, task breakdown, dispatch,
  monitoring, and reporting. It never does the task work itself; it only
  coordinates, so nothing moves without your approval.
- **Workers** — background agents (`skyforge-worker`), one task apiece, carried
  end to end and returned as a structured completion report. Any task that
  writes files runs inside its own isolated git worktree, so parallel workers
  never clobber each other or your working tree.
- **Board** — a durable ledger at `.skyforge/board.json` in the current
  repository, written only through `scripts/board.mjs`. It survives restarts, so
  the shop always remembers where it stood.

Every task lives in exactly one of five states: `queued`, `running`, `done`,
`blocked`, `failed`.

## Install

**Just ask your AI.** In Claude Code (or any coding agent), say:

> Please install this skill: https://github.com/Andrew2142/Skyforge

The agent reads this page and runs the one-line installer below — that's it.

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

Trigger it in natural language — the manager listens for intent, not exact words:

- `skyforge`
- `delegate this to the team`
- `spin up the factory`
- `how's the factory doing?`

The manager proposes a task breakdown and **waits for your approval** before
dispatching anything. Ask for status any time (`how's the factory?`) to get a
grouped report of what's running, blocked, and ready for review.

## Repository layout

```
install.sh                one-line installer (clones + copies into ~/.claude)
SKILL.md                  the skill definition (the manager's operating loop)
references/protocol.md    board schema, worker-prompt template, report format, edge cases
scripts/board.mjs         the ledger CLI — the only writer of .skyforge/board.json
agents/skyforge-worker.md the background worker subagent + its completion-report format
docs/index.html           a standalone landing page describing the skill
```

## The board CLI

`scripts/board.mjs` is the single source of truth for the ledger. Quick reference:

| Command | Purpose |
|---|---|
| `node board.mjs init` | Create `.skyforge/board.json` + `tasks/` (idempotent) |
| `node board.mjs add --title "..." [--parent T-00N] [--brief "..."]` | Add a task; prints its id |
| `node board.mjs set <id> --status <s> [--agent <id>] [--summary "..."]` | Update a task |
| `node board.mjs list [--status <s>]` | Compact task table |
| `node board.mjs get <id>` | Full JSON for one task |
| `node board.mjs note <id> "text"` | Append text to the task's brief file |
| `node board.mjs report` | Grouped human-readable status |

Requires Node.js (uses only built-in modules — no dependencies).
