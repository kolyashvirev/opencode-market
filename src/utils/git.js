import { execa } from 'execa';
import fse from 'fs-extra';
import crypto from 'crypto';
import os from 'os';
import path from 'path';

/**
 * Git-over-SSH provider. Works against any Git remote reachable over SSH
 * (self-hosted or gitlab.com / github.com), authenticating with the user's SSH
 * keys (ssh-agent, ~/.ssh/*). No API token is required.
 *
 * Implements the same provider interface as github.js / gitlab.js:
 * fetchRawFile / fetchJsonFile / listDirectory / getDefaultBranch.
 *
 * Each function receives an `entry` descriptor: { project, host }.
 * The clone URL is built as `git@<host>:<project>.git`.
 *
 * The repository is shallow-cloned once per (url, ref) and cached for the
 * lifetime of the process, so repeated file/dir reads during a single command
 * reuse the same working tree. Call cleanup() when the command is done.
 */

// SSH over keys only: never prompt for a password, auto-accept new host keys.
const DEFAULT_SSH_COMMAND = 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new';

function sshEnv() {
  return { ...process.env, GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || DEFAULT_SSH_COMMAND };
}

const checkoutCache = new Map(); // `${url}#${ref}` -> absolute working-tree dir

function cloneUrl(entry) {
  return `git@${entry.host}:${entry.project}.git`;
}

function runGit(args, opts = {}) {
  return execa('git', args, { reject: false, env: sshEnv(), ...opts });
}

/**
 * Resolve a remote's default branch via `git ls-remote --symref` (no full clone).
 * @param {object} entry
 * @returns {Promise<string>}
 */
export async function getDefaultBranch(entry) {
  const res = await runGit(['ls-remote', '--symref', cloneUrl(entry), 'HEAD']);
  if (res.exitCode !== 0) return 'main';
  const match = res.stdout.match(/ref:\s+refs\/heads\/(\S+)\s+HEAD/);
  return match ? match[1] : 'main';
}

async function ensureCheckout(entry, ref) {
  const url = cloneUrl(entry);
  const key = `${url}#${ref}`;
  if (checkoutCache.has(key)) return checkoutCache.get(key);

  const dir = path.join(os.tmpdir(), 'opencode-market-git', crypto.randomBytes(6).toString('hex'));
  await fse.ensureDir(path.dirname(dir));

  let res = await runGit(['clone', '--quiet', '--depth', '1', '--branch', ref, url, dir]);
  if (res.exitCode !== 0) {
    // `ref` may be a commit SHA or a commit not pointed at by a branch/tag:
    // clone the default branch then fetch + check out the specific ref.
    await fse.remove(dir);
    res = await runGit(['clone', '--quiet', url, dir]);
    if (res.exitCode !== 0) {
      throw new Error(`git clone failed: ${res.stderr.trim() || url}`);
    }
    const co = await runGit(['checkout', '--quiet', ref], { cwd: dir });
    if (co.exitCode !== 0) {
      throw new Error(`git checkout ${ref} failed: ${co.stderr.trim()}`);
    }
  }

  checkoutCache.set(key, dir);
  return dir;
}

/**
 * Read a file's raw contents from the checked-out tree.
 * @returns {Promise<string|null>}
 */
export async function fetchRawFile(entry, ref, filePath) {
  const dir = await ensureCheckout(entry, ref);
  const target = path.join(dir, filePath);
  const rel = path.relative(dir, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null; // path traversal guard
  if (!await fse.pathExists(target)) return null;
  const stat = await fse.stat(target);
  if (stat.isDirectory()) return null;
  return fse.readFile(target, 'utf-8');
}

/**
 * Fetch and parse a JSON file from the checked-out tree.
 * @returns {Promise<object|null>}
 */
export async function fetchJsonFile(entry, ref, filePath) {
  const text = await fetchRawFile(entry, ref, filePath);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Recursively collect files under `absRoot`, returning { path, type } with
// repo-relative (slash-separated) paths. Avoids fs.readdir({recursive}) which
// is not available on all supported Node versions.
async function walk(absRoot, relRoot) {
  const out = [];
  const entries = await fse.readdir(absRoot, { withFileTypes: true });
  for (const ent of entries) {
    const relPath = relRoot ? `${relRoot}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      if (ent.name === '.git') continue;
      out.push({ path: relPath, type: 'tree' });
      out.push(...await walk(path.join(absRoot, ent.name), relPath));
    } else {
      out.push({ path: relPath, type: 'blob' });
    }
  }
  return out;
}

/**
 * List files under a directory of the checked-out tree.
 * @param {object} entry
 * @param {string} ref
 * @param {string} dirPath - repo-relative directory (empty string = repo root)
 * @returns {Promise<Array<{path: string, type: string}>>}
 */
export async function listDirectory(entry, ref, dirPath) {
  const dir = await ensureCheckout(entry, ref);
  const normalized = (dirPath || '').replace(/^\/+|\/+$/g, '');
  const abs = normalized ? path.join(dir, normalized) : dir;

  const rel = path.relative(dir, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return [];
  if (!await fse.pathExists(abs)) return [];
  const stat = await fse.stat(abs);
  if (!stat.isDirectory()) return [];

  return walk(abs, normalized);
}

/**
 * Remove all temporary checkouts created during this process.
 */
export async function cleanup() {
  const dirs = [...checkoutCache.values()];
  checkoutCache.clear();
  await Promise.all(dirs.map(d => fse.remove(d).catch(() => {})));
}
