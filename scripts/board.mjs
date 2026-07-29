#!/usr/bin/env node
// board.mjs — the Skyforge factory ledger.
// Owns every read/write of .skyforge/board.json so the JSON is never hand-corrupted.
// Usage:
//   node board.mjs init [--mode worktree|guardrail] [--auto on|off]
//   node board.mjs mode [--set worktree|guardrail]
//   node board.mjs auto [--set on|off]
//   node board.mjs add --title "..." [--assignee skyforge-worker] [--parent T-003] [--brief "..."] [--files "src/a.ts,src/api"] [--blocked-by "T-001,T-002"]
//   node board.mjs set <id> --status running [--agent <agentId>] [--summary "..."] [--title "..."] [--files "..."] [--blocked-by "T-001"]
//   node board.mjs list [--status running]
//   node board.mjs get <id>
//   node board.mjs ready         # queued tasks safe to dispatch now (mode-aware); names each blocked task's blocker(s)
//   node board.mjs report
//   node board.mjs note <id> "text appended to the task brief"
// All paths are relative to the current working directory (per-project ledger).

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), '.skyforge');
const BOARD = join(ROOT, 'board.json');
const TASKS = join(ROOT, 'tasks');
const STATUSES = ['queued', 'running', 'done', 'failed', 'blocked'];
const MODES = ['worktree', 'guardrail'];

function fail(msg) {
  console.error(`board: ${msg}`);
  process.exit(1);
}

function nowISO() {
  return new Date().toISOString();
}

function truthy(v) {
  if (v === true) return true;
  return ['on', 'true', 'yes', '1'].includes(String(v).toLowerCase());
}

function newBoard(mode, auto) {
  return { version: 1, seq: 0, createdAt: nowISO(), mode: mode || 'worktree', auto: !!auto, tasks: [] };
}

function ensureRoot() {
  if (!existsSync(ROOT)) mkdirSync(ROOT, { recursive: true });
  if (!existsSync(TASKS)) mkdirSync(TASKS, { recursive: true });
}

function load() {
  if (!existsSync(BOARD)) fail(`no board found at ${BOARD}. Run "board.mjs init" first.`);
  try {
    const b = JSON.parse(readFileSync(BOARD, 'utf8'));
    if (!b.mode) b.mode = 'worktree'; // tolerate pre-mode boards
    if (b.auto === undefined) b.auto = false;
    return b;
  } catch (e) {
    fail(`board.json is not valid JSON: ${e.message}`);
  }
}

function save(board) {
  // Atomic write: write to a temp file then rename over the target.
  const tmp = `${BOARD}.tmp`;
  writeFileSync(tmp, JSON.stringify(board, null, 2) + '\n');
  renameSync(tmp, BOARD);
}

function taskFile(id) {
  return join(TASKS, `${id}.md`);
}

// --- file-overlap helpers (guardrail mode) -----------------------------------
function parseFiles(v) {
  if (!v || v === true) return [];
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}
// Task ids for --blocked-by: accept either commas or whitespace as separators
// (paths in --files can contain spaces, so those stay comma-only via parseFiles).
function parseIds(v) {
  if (!v || v === true) return [];
  return String(v).split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}
function norm(p) {
  return p.replace(/^\.\//, '').replace(/\/+$/, '').replace(/\/\*+$/, '');
}
// Two paths conflict if equal, or one contains the other as a directory.
function pathsConflict(a, b) {
  a = norm(a); b = norm(b);
  if (a === b) return true;
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}
// Why a queued task can't start yet, attributed to specific task ids so the
// manager reports the blocker off the board instead of narrating it:
//   deps     — its blockedBy entries that aren't done yet (both modes)
//   fileHits — claimer task ids whose declared area overlaps it (guardrail only)
// `claimers` are the tasks currently holding ground: running tasks, plus any
// task already selected earlier in the same `ready` batch.
function taskBlockers(board, t, claimers, doneIds) {
  const deps = (t.blockedBy || []).filter((id) => !doneIds.has(id));
  const fileHits = [];
  if (board.mode === 'guardrail') {
    for (const c of claimers) {
      if (c.id === t.id) continue;
      const hit = (t.files || []).some((p) => (c.files || []).some((cp) => pathsConflict(p, cp)));
      if (hit) fileHits.push(c.id);
    }
  }
  return { deps, fileHits };
}

// --- argument parsing --------------------------------------------------------
// Splits argv into positionals and --flags (each flag takes the next token,
// unless the next token is another flag, in which case the flag is boolean).
function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

// --- commands ----------------------------------------------------------------
function cmdInit(flags) {
  ensureRoot();
  const mode = flags.mode && flags.mode !== true ? String(flags.mode) : 'worktree';
  if (!MODES.includes(mode)) fail(`mode must be one of: ${MODES.join(', ')}`);
  const auto = 'auto' in flags ? truthy(flags.auto) : false;
  if (!existsSync(BOARD)) {
    save(newBoard(mode, auto));
    console.log(`Initialised ledger at ${BOARD} (mode: ${mode}, auto: ${auto ? 'on' : 'off'})`);
  } else {
    const b = load();
    console.log(`Ledger already exists at ${BOARD} (mode: ${b.mode}, auto: ${b.auto ? 'on' : 'off'})`);
  }
}

function cmdMode(flags) {
  const board = load();
  if (flags.set && flags.set !== true) {
    const m = String(flags.set);
    if (!MODES.includes(m)) fail(`mode must be one of: ${MODES.join(', ')}`);
    board.mode = m;
    save(board);
    console.log(`mode set to ${m}`);
  } else {
    console.log(board.mode);
  }
}

function cmdAuto(flags) {
  const board = load();
  if ('set' in flags) {
    board.auto = truthy(flags.set);
    save(board);
    console.log(`auto ${board.auto ? 'on' : 'off'}`);
  } else {
    console.log(board.auto ? 'on' : 'off');
  }
}

function cmdAdd(flags) {
  ensureRoot();
  const board = existsSync(BOARD) ? load() : newBoard();
  if (!flags.title || flags.title === true) fail('add requires --title "..."');
  board.seq += 1;
  const id = `T-${String(board.seq).padStart(3, '0')}`;
  const files = parseFiles(flags.files);
  const blockedBy = parseIds(flags['blocked-by']);
  const task = {
    id,
    title: String(flags.title),
    assignee: flags.assignee && flags.assignee !== true ? String(flags.assignee) : 'skyforge-worker',
    agentId: null,
    status: 'queued',
    parent: flags.parent && flags.parent !== true ? String(flags.parent) : null,
    files,
    blockedBy,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    resultSummary: '',
  };
  board.tasks.push(task);
  save(board);

  // Seed a human-readable brief file for the task.
  const brief = flags.brief && flags.brief !== true ? String(flags.brief) : '(fill in the brief)';
  const body = `# ${id} — ${task.title}\n\n`
    + `- Status: ${task.status}\n`
    + `- Assignee: ${task.assignee}\n`
    + (task.parent ? `- Parent: ${task.parent}\n` : '')
    + (files.length ? `- Files: ${files.join(', ')}\n` : '')
    + (blockedBy.length ? `- Blocked by: ${blockedBy.join(', ')}\n` : '')
    + `- Created: ${task.createdAt}\n\n`
    + `## Brief\n\n${brief}\n\n`
    + `## Result\n\n_(pending)_\n`;
  writeFileSync(taskFile(id), body);
  console.log(id);
}

function findTask(board, id) {
  const t = board.tasks.find((x) => x.id === id);
  if (!t) fail(`no task ${id}`);
  return t;
}

function cmdSet(positionals, flags) {
  const id = positionals[0];
  if (!id) fail('set requires a task id, e.g. "board.mjs set T-001 --status running"');
  const board = load();
  const t = findTask(board, id);
  if (flags.status) {
    if (!STATUSES.includes(flags.status)) fail(`status must be one of: ${STATUSES.join(', ')}`);
    t.status = flags.status;
  }
  if (flags.agent && flags.agent !== true) t.agentId = String(flags.agent);
  if (flags.summary && flags.summary !== true) t.resultSummary = String(flags.summary);
  if (flags.title && flags.title !== true) t.title = String(flags.title);
  if ('files' in flags) t.files = parseFiles(flags.files);
  if ('blocked-by' in flags) t.blockedBy = parseIds(flags['blocked-by']);
  t.updatedAt = nowISO();
  save(board);
  console.log(`${id} -> status=${t.status}${t.agentId ? ` agent=${t.agentId}` : ''}`);
}

function cmdList(flags) {
  const board = load();
  let tasks = board.tasks;
  if (flags.status && flags.status !== true) tasks = tasks.filter((t) => t.status === flags.status);
  if (tasks.length === 0) {
    console.log('(no tasks)');
    return;
  }
  for (const t of tasks) {
    const agent = t.agentId ? ` [${t.agentId.slice(0, 8)}]` : '';
    console.log(`${t.id}  ${t.status.padEnd(8)}  ${t.assignee.padEnd(14)}${agent}  ${t.title}`);
  }
}

function cmdGet(positionals) {
  const id = positionals[0];
  if (!id) fail('get requires a task id');
  const board = load();
  console.log(JSON.stringify(findTask(board, id), null, 2));
}

// Which queued tasks are safe to dispatch right now, and why the rest wait?
// A queued task is held if either gate fails:
//   - dependency gate (both modes): a blockedBy task isn't done yet
//   - file gate (guardrail): its area overlaps a running task, or one already
//     selected earlier in this batch
// Every queued task is reported: READY, or BLOCKED with the specific id(s)
// holding it — so the manager states the blocker from the board, not from memory.
function cmdReady() {
  const board = load();
  const queued = board.tasks.filter((t) => t.status === 'queued');
  if (queued.length === 0) {
    console.log('(nothing queued)');
    return;
  }
  const doneIds = new Set(board.tasks.filter((t) => t.status === 'done').map((t) => t.id));
  const claimers = board.tasks.filter((t) => t.status === 'running'); // grows as we select
  const selected = [];
  const blocked = [];
  for (const t of queued) {
    const { deps, fileHits } = taskBlockers(board, t, claimers, doneIds);
    if (deps.length === 0 && fileHits.length === 0) {
      selected.push(t);
      claimers.push(t);
    } else {
      blocked.push({ t, deps, fileHits });
    }
  }

  if (selected.length === 0) {
    console.log('READY: (none)');
  } else {
    console.log('READY:');
    for (const t of selected) {
      const f = board.mode === 'guardrail' ? `   [${(t.files || []).join(', ') || 'read-only'}]` : '';
      console.log(`  ${t.id}  ${t.title}${f}`);
    }
  }
  if (blocked.length) {
    console.log('BLOCKED:');
    for (const { t, deps, fileHits } of blocked) {
      const why = [];
      if (deps.length) why.push(`waiting on ${deps.join(', ')} (dependency)`);
      if (fileHits.length) why.push(`file conflict with ${fileHits.join(', ')}`);
      console.log(`  ${t.id}  ${t.title}  — ${why.join('; ')}`);
    }
  }
}

function cmdReport() {
  const board = load();
  const running = board.tasks.filter((t) => t.status === 'running');
  const doneIds = new Set(board.tasks.filter((t) => t.status === 'done').map((t) => t.id));
  const by = Object.fromEntries(STATUSES.map((s) => [s, []]));
  for (const t of board.tasks) (by[t.status] || (by[t.status] = [])).push(t);

  const total = board.tasks.length;
  console.log(`Skyforge factory — ${total} task${total === 1 ? '' : 's'}  ·  mode: ${board.mode}  ·  auto: ${board.auto ? 'on' : 'off'}`);
  console.log('='.repeat(48));
  const order = ['running', 'blocked', 'queued', 'failed', 'done'];
  const icon = { running: '🔧', blocked: '⛔', queued: '⏳', failed: '❌', done: '✅' };
  for (const status of order) {
    const list = by[status] || [];
    if (list.length === 0) continue;
    console.log(`\n${icon[status] || '•'} ${status.toUpperCase()} (${list.length})`);
    for (const t of list) {
      const agent = t.agentId ? ` [${t.agentId.slice(0, 8)}]` : '';
      console.log(`  ${t.id}  ${t.title}${agent}`);
      if (board.mode === 'guardrail' && t.files && t.files.length && (status === 'running' || status === 'queued')) {
        console.log(`        files: ${t.files.join(', ')}`);
      }
      if (status === 'queued') {
        const { deps, fileHits } = taskBlockers(board, t, running, doneIds);
        const why = [];
        if (deps.length) why.push(`deps ${deps.join(', ')}`);
        if (fileHits.length) why.push(`files ${fileHits.join(', ')}`);
        if (why.length) console.log(`        ⤷ waiting on: ${why.join('; ')}`);
      }
      if (t.resultSummary) console.log(`        ↳ ${t.resultSummary}`);
    }
  }
  const open = (by.running.length + by.queued.length + by.blocked.length);
  console.log(`\n${open} open, ${by.done.length} done, ${by.failed.length} failed.`);
}

// --- dispatch ----------------------------------------------------------------
const [, , cmd, ...rest] = process.argv;
const { positionals, flags } = parseArgs(rest);

switch (cmd) {
  case 'init': cmdInit(flags); break;
  case 'mode': cmdMode(flags); break;
  case 'auto': cmdAuto(flags); break;
  case 'add': cmdAdd(flags); break;
  case 'set': cmdSet(positionals, flags); break;
  case 'list': cmdList(flags); break;
  case 'get': cmdGet(positionals); break;
  case 'ready': cmdReady(); break;
  case 'note': cmdNote(positionals); break;
  case 'report': cmdReport(); break;
  default:
    console.log('board.mjs commands: init | mode | auto | add | set | list | get | ready | note | report');
    if (cmd) fail(`unknown command "${cmd}"`);
}

function cmdNote(positionals) {
  const id = positionals[0];
  const text = positionals.slice(1).join(' ');
  if (!id || !text) fail('note requires: board.mjs note <id> "text"');
  const board = load();
  findTask(board, id); // validate existence
  const file = taskFile(id);
  const prev = existsSync(file) ? readFileSync(file, 'utf8') : `# ${id}\n`;
  writeFileSync(file, `${prev.trimEnd()}\n\n---\n_${nowISO()}_\n\n${text}\n`);
  console.log(`appended note to ${file}`);
}
