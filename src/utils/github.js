import { execa } from 'execa';

/**
 * GitHub provider. Implements the provider interface used across commands:
 * fetchRawFile / fetchJsonFile / listDirectory / getDefaultBranch.
 *
 * Each function receives an `entry` descriptor: { project } where `project`
 * is "owner/repo". GitHub only supports a two-segment path, so extra path
 * segments (if any) are ignored when resolving owner/repo.
 */

/**
 * Get a GitHub auth token.
 * Checks GITHUB_TOKEN env var first, then falls back to `gh auth token`.
 * Returns null if neither is available (public repos work without auth).
 */
async function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;

  try {
    const result = await execa('gh', ['auth', 'token'], { reject: false });
    if (result.exitCode === 0 && result.stdout.trim()) return result.stdout.trim();
  } catch {
    // gh not installed or not authenticated
  }

  return null;
}

function splitProject(project) {
  const idx = project.indexOf('/');
  if (idx === -1) throw new Error(`Invalid GitHub project: ${project}. Expected owner/repo`);
  return [project.slice(0, idx), project.slice(idx + 1).split('/')[0]];
}

/**
 * Fetch a file from GitHub raw content API.
 * @param {{ project: string }} entry
 * @param {string} ref - branch or tag (e.g. "main")
 * @param {string} filePath - path within the repo
 * @returns {Promise<string|null>} file contents or null if not found
 */
export async function fetchRawFile(entry, ref, filePath) {
  const [owner, repo] = splitProject(entry.project);
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`;
  const token = await getToken();

  const headers = {};
  if (token) headers.Authorization = `token ${token}`;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  return res.text();
}

/**
 * Fetch and parse a JSON file from GitHub.
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

/**
 * Resolve a repo's default branch (falls back to "main").
 * @param {{ project: string }} entry
 * @returns {Promise<string>}
 */
export async function getDefaultBranch(entry) {
  const [owner, repo] = splitProject(entry.project);
  const token = await getToken();
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `token ${token}`;

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers, signal: AbortSignal.timeout(10000) });
  if (!res.ok) return 'main';
  const data = await res.json();
  return data.default_branch || 'main';
}

/**
 * List files in a GitHub directory using the Trees API.
 * Returns an array of { path, type } with repo-relative paths.
 * @param {{ project: string }} entry
 * @param {string} ref
 * @param {string} dirPath - directory path within the repo (no trailing slash)
 * @returns {Promise<Array<{path: string, type: string}>>}
 */
export async function listDirectory(entry, ref, dirPath) {
  const [owner, repo] = splitProject(entry.project);
  const token = await getToken();
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `token ${token}`;

  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

  const data = await res.json();
  const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;

  return data.tree
    .filter(item => item.path.startsWith(prefix))
    .map(item => ({
      path: item.path,
      type: item.type, // "blob" or "tree"
    }));
}
