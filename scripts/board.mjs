#!/usr/bin/env node
// board.mjs — the Skyforge factory ledger.
// Owns every read/write of .skyforge/board.json so the JSON is never hand-corrupted.
// Usage:
//   node board.mjs init
//   node board.mjs add --title "..." [--assignee skyforge-worker] [--parent T-003] [--brief "..."]
//   node board.mjs set <id> --status running [--agent <agentId>] [--summary "..."] [--title "..."]
//   node board.mjs list [--status running]
//   node board.mjs get <id>
//   node board.mjs report
//   node board.mjs note <id> "text appended to the task brief"
// All paths are relative to the current working directory (per-project ledger).

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), '.skyforge');
const BOARD = join(ROOT, 'board.json');
const TASKS = join(ROOT, 'tasks');
const STATUSES = ['queued', 'running', 'done', 'failed', 'blocked'];

function fail(msg) {
  console.error(`board: ${msg}`);
  process.exit(1);
}

function nowISO() {
  return new Date().toISOString();
}

function ensureRoot() {
  if (!existsSync(ROOT)) mkdirSync(ROOT, { recursive: true });
  if (!existsSync(TASKS)) mkdirSync(TASKS, { recursive: true });
}

function load() {
  if (!existsSync(BOARD)) fail(`no board found at ${BOARD}. Run "board.mjs init" first.`);
  try {
    return JSON.parse(readFileSync(BOARD, 'utf8'));
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
function cmdInit() {
  ensureRoot();
  if (!existsSync(BOARD)) {
    save({ version: 1, seq: 0, createdAt: nowISO(), tasks: [] });
    console.log(`Initialised ledger at ${BOARD}`);
  } else {
    console.log(`Ledger already exists at ${BOARD}`);
  }
}

function cmdAdd(flags) {
  ensureRoot();
  const board = existsSync(BOARD) ? load() : { version: 1, seq: 0, createdAt: nowISO(), tasks: [] };
  if (!flags.title || flags.title === true) fail('add requires --title "..."');
  board.seq += 1;
  const id = `T-${String(board.seq).padStart(3, '0')}`;
  const task = {
    id,
    title: String(flags.title),
    assignee: flags.assignee && flags.assignee !== true ? String(flags.assignee) : 'skyforge-worker',
    agentId: null,
    status: 'queued',
    parent: flags.parent && flags.parent !== true ? String(flags.parent) : null,
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

function cmdReport() {
  const board = load();
  const by = Object.fromEntries(STATUSES.map((s) => [s, []]));
  for (const t of board.tasks) (by[t.status] || (by[t.status] = [])).push(t);

  const total = board.tasks.length;
  console.log(`Skyforge factory — ${total} task${total === 1 ? '' : 's'}`);
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
  case 'init': cmdInit(); break;
  case 'add': cmdAdd(flags); break;
  case 'set': cmdSet(positionals, flags); break;
  case 'list': cmdList(flags); break;
  case 'get': cmdGet(positionals); break;
  case 'note': cmdNote(positionals); break;
  case 'report': cmdReport(); break;
  default:
    console.log('board.mjs commands: init | add | set | list | get | note | report');
    if (cmd) fail(`unknown command "${cmd}"`);
}
