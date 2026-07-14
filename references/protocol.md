# Skyforge protocol reference

Detailed material kept out of SKILL.md: the board schema, the worker-prompt template, the completion-report format, and edge cases.

## Board schema (`.skyforge/board.json`)

```json
{
  "version": 1,
  "seq": 3,
  "createdAt": "2026-07-13T11:00:00.000Z",
  "tasks": [
    {
      "id": "T-001",
      "title": "Add rate limiting to the login endpoint",
      "assignee": "skyforge-worker",
      "agentId": "ad7f0c42fc1862060",
      "status": "running",
      "parent": null,
      "createdAt": "2026-07-13T11:00:01.000Z",
      "updatedAt": "2026-07-13T11:02:10.000Z",
      "resultSummary": ""
    }
  ]
}
```

- `seq` is a monotonic counter; ids are `T-` + zero-padded seq. Never reused.
- `agentId` is the Agent-tool id of the worker — used to continue a worker via SendMessage.
- `status` is one of `queued | running | done | failed | blocked`.
- `parent` groups subtasks split from one larger request.
- Full briefs and final reports live in `.skyforge/tasks/<id>.md`, not in the JSON (keeps the JSON small and the briefs readable).

## Worker-prompt template

When launching a `skyforge-worker`, compose the prompt from the task brief:

```
You are Skyforge worker for task <ID>: <TITLE>.

## Goal
<what done looks like, in one or two sentences>

## Context
<repo/paths/constraints the worker needs; relevant file paths>

## Definition of done
<checklist the worker must satisfy>

## Reporting
Complete the task end-to-end. Verify your work. Then return your final answer
in the Skyforge completion-report format (STATUS / SUMMARY / ARTIFACTS /
VERIFICATION / FOLLOW-UPS / BLOCKERS). Your final message IS the report — no
preamble.
```

Launch options:
- File-editing task → Agent tool with `isolation: "worktree"`.
- Read-only research task → no isolation.
- Always `subagent_type: "skyforge-worker"`.
- Launch independent workers in one message (concurrent). Concurrency is capped by the Agent tool; excess workers queue — leave those board entries `queued` and note it to the user.

## Completion-report format

Workers return exactly these sections. The manager parses them into the board.

```
STATUS: done | failed | blocked
SUMMARY: <2–4 sentences on what was accomplished>
ARTIFACTS: <files created/changed with paths; worktree name if isolated; or "none (research)">
VERIFICATION: <how it was checked — tests run, build, manual reasoning — with outcomes>
FOLLOW-UPS: <suggested next tasks, or "none">
BLOCKERS: <what stopped completion and what input is needed, or "none">
```

Map to the board:
- `STATUS: done` → `set <id> --status done --summary "<SUMMARY, trimmed>"`
- `STATUS: failed` → `set <id> --status failed --summary "<why>"`
- `STATUS: blocked` → `set <id> --status blocked --summary "<what's needed>"`, then ask the user for the missing input.
- Always append the full report with `note <id> "..."` before setting status.
- Turn each concrete FOLLOW-UP into a proposed task at the next intake (step 2), not an auto-dispatched one.

## Edge cases

**Worker died / terminal error.** The Agent tool returns null or an error notification. Set the task `failed` with a summary of the error and offer to re-dispatch (optionally with a narrower brief).

**Blocked task.** Do not spin the worker in a loop. Mark `blocked`, capture the exact question in the summary, and surface it to the user. Resume by re-dispatching once the user answers, or continue the same worker via SendMessage if it is still alive.

**Session-restart recovery.** On a new session with an existing board: run `report`. Every `running` task is orphaned (its worker is gone). Present them and offer re-dispatch. Never report an orphaned `running` task as if it were live.

**Concurrency backpressure.** If more tasks are approved than can run at once, dispatch what fits, leave the rest `queued`, and tell the user how many are waiting. As workers finish, dispatch queued tasks.

**Worktree review.** A worktree task's changes stay in an isolated worktree until the user reviews. Report the diff summary and the worktree location; never merge without approval.

**Multiple projects.** The board is per-cwd (`.skyforge/` in the working directory). Running the factory from a different repo uses a separate board — this is intentional.
