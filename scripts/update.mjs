#!/usr/bin/env node
// update.mjs — keeps the installed Skyforge in sync with the upstream repo.
// Called once per spin-up by the manager (step 1); self-throttles so only the
// first run of the day actually touches the network.
// Usage:
//   node update.mjs                    # throttled check, applies an update if there is one
//   node update.mjs --check            # report only, never writes the install
//   node update.mjs --force            # ignore the once-a-day throttle
//   node update.mjs --overwrite-local  # replace installed files that were edited locally
//   node update.mjs --quiet            # print only when something changed
// Never fails the caller: a network problem exits 0 with a note, so Skyforge
// still starts when GitHub is unreachable.

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const REPO = 'Andrew2142/Skyforge';
const BRANCH = 'main';
const THROTTLE_MS = 24 * 60 * 60 * 1000; // once a day
const TIMEOUT_MS = 5000;

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const SKILL_DIR = join(CLAUDE_DIR, 'skills', 'skyforge');
const AGENTS_DIR = join(CLAUDE_DIR, 'agents');
const STATE = join(CLAUDE_DIR, '.skyforge-update.json');

// repo path -> installed path. update.mjs is in here so it can replace itself.
const FILES = {
  'SKILL.md': join(SKILL_DIR, 'SKILL.md'),
  'references/protocol.md': join(SKILL_DIR, 'references', 'protocol.md'),
  'scripts/board.mjs': join(SKILL_DIR, 'scripts', 'board.mjs'),
  'scripts/dashboard.mjs': join(SKILL_DIR, 'scripts', 'dashboard.mjs'),
  'scripts/update.mjs': join(SKILL_DIR, 'scripts', 'update.mjs'),
  'agents/skyforge-worker.md': join(AGENTS_DIR, 'skyforge-worker.md'),
};

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const CHECK_ONLY = has('--check');
const FORCE = has('--force');
const OVERWRITE_LOCAL = has('--overwrite-local');
const QUIET = has('--quiet');

function say(msg) {
  console.log(`skyforge: ${msg}`);
}
// Nothing here is worth breaking a spin-up over — always leave with 0.
function done(msg, { changed = false } = {}) {
  if (msg && (!QUIET || changed)) say(msg);
  process.exit(0);
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const short = (sha) => (sha ? sha.slice(0, 7) : '?');

function versionOf(text) {
  // Read the frontmatter block itself — the description line alone runs to
  // several hundred characters, so a fixed-size slice would miss `version:`.
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const m = /^version:\s*(.+)$/m.exec(fm ? fm[1] : '');
  return m ? m[1].trim() : null;
}

function readState() {
  if (!existsSync(STATE)) return null;
  try {
    return JSON.parse(readFileSync(STATE, 'utf8'));
  } catch {
    return null; // unreadable state is the same as no state — re-derive it
  }
}

function writeState(state) {
  const tmp = `${STATE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, STATE);
}

function writeFile(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

async function get(url, accept) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'skyforge-updater', ...(accept ? { Accept: accept } : {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

const state = readState();
const now = Date.now();

// --- throttle: only the first spin-up of the day pays for a network round-trip
if (!FORCE && !CHECK_ONLY && state?.checkedAt) {
  const age = now - Date.parse(state.checkedAt);
  if (age >= 0 && age < THROTTLE_MS) {
    const hrs = Math.floor(age / 3600000);
    done(`update check skipped (last checked ${hrs}h ago; --force to check now)`, { changed: false });
  }
}

// --- resolve upstream HEAD
let remoteSha;
try {
  remoteSha = (await get(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, 'application/vnd.github.sha')).trim();
} catch (err) {
  done(`update check skipped — could not reach GitHub (${err.message.split('\n')[0]})`);
}
if (!/^[0-9a-f]{40}$/.test(remoteSha)) done('update check skipped — unexpected response from GitHub');

// Record that we looked, even when there is nothing to do, so the throttle holds.
const stamp = (extra = {}) => writeState({ repo: REPO, ...(state || {}), ...extra, checkedAt: new Date(now).toISOString() });

if (state?.sha === remoteSha && !FORCE) {
  stamp();
  done(`up to date (${state.version || '?'}, ${short(remoteSha)})`);
}

// --- fetch every installed file at the pinned sha, then verify before writing anything
let incoming;
try {
  const entries = await Promise.all(
    Object.keys(FILES).map(async (repoPath) => [
      repoPath,
      await get(`https://raw.githubusercontent.com/${REPO}/${remoteSha}/${repoPath}`),
    ]),
  );
  incoming = Object.fromEntries(entries);
} catch (err) {
  done(`update available (${short(remoteSha)}) but download failed — ${err.message.split('\n')[0]}`);
}
if (Object.values(incoming).some((t) => !t || !t.trim())) done('update aborted — upstream returned an empty file');

const newVersion = versionOf(incoming['SKILL.md']);

// --- what would actually change on disk?
const changed = [];
const localEdits = [];
for (const [repoPath, target] of Object.entries(FILES)) {
  const next = incoming[repoPath];
  const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
  if (current === next) continue;
  // A file whose hash no longer matches what we installed was edited locally;
  // never silently throw that away.
  const recorded = state?.files?.[repoPath];
  if (current !== null && recorded && sha256(current) !== recorded) localEdits.push(repoPath);
  changed.push(repoPath);
}

if (!changed.length) {
  stamp({ sha: remoteSha, version: newVersion, files: Object.fromEntries(Object.entries(FILES).map(([r]) => [r, sha256(incoming[r])])) });
  done(`up to date (${newVersion || '?'}, ${short(remoteSha)})`);
}

// Only show a version arrow when the version actually moved; most updates are
// same-version commits, and "0.1.0 → 0.1.0" reads like a bug.
const ver = state?.version && state.version !== newVersion ? `${state.version} → ${newVersion || '?'}` : newVersion || '?';
const from = `${ver} (${short(state?.sha)} → ${short(remoteSha)})`;

if (CHECK_ONLY) {
  done(`update available ${from}, ${changed.length} file(s) — run: node ${join(SKILL_DIR, 'scripts', 'update.mjs')} --force`, { changed: true });
}

const blocked = OVERWRITE_LOCAL ? [] : localEdits;
if (blocked.length === changed.length) {
  stamp();
  done(`update ${from} held back — ${blocked.join(', ')} edited locally (re-run with --overwrite-local to replace)`, { changed: true });
}

// --- apply
const applied = [];
for (const repoPath of changed) {
  if (blocked.includes(repoPath)) continue;
  writeFile(FILES[repoPath], incoming[repoPath]);
  applied.push(repoPath);
}

writeState({
  repo: REPO,
  sha: remoteSha,
  version: newVersion,
  checkedAt: new Date(now).toISOString(),
  installedAt: new Date(now).toISOString(),
  // Hash what is on disk now, so a file we skipped stays flagged as locally edited.
  files: Object.fromEntries(
    Object.entries(FILES).map(([repoPath, target]) => [
      repoPath,
      sha256(existsSync(target) ? readFileSync(target, 'utf8') : incoming[repoPath]),
    ]),
  ),
});

const notes = [];
if (blocked.length) notes.push(`kept your local ${blocked.join(', ')}`);
// SKILL.md is already in the model's context by the time this runs.
if (applied.includes('SKILL.md') || applied.includes('agents/skyforge-worker.md')) {
  notes.push('restart this session to load the new instructions');
}
say(`updated ${from} — ${applied.length} file(s)${notes.length ? '; ' + notes.join('; ') : ''}`);
