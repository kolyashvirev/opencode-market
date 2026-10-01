/**
 * GitLab provider (gitlab.com and self-hosted instances). Implements the same
 * provider interface as github.js: fetchRawFile / fetchJsonFile / listDirectory / getDefaultBranch.
 *
 * Each function receives an `entry` descriptor:
 *   { project, host?, scheme? }
 * - `project` is the full project path, possibly nested (e.g. "group/subgroup/repo").
 *   It is URL-encoded as a single path segment (the GitLab API expects this).
 * - `host`   is the instance host[:port] without scheme (defaults to "gitlab.com").
 * - `scheme` is "https" (default) or "http" (for plain-HTTP local instances).
 *
 * Auth: set GITLAB_TOKEN (or GL_TOKEN) to a GitLab personal/project access
 * token; it is sent as the `PRIVATE-TOKEN` header. Public projects work without it.
 */

function getBaseUrl(entry) {
  const scheme = entry.scheme || 'https';
  const host = entry.host || 'gitlab.com';
  return `${scheme}://${host}`;
}

function getProjectId(entry) {
  return encodeURIComponent(entry.project);
}

function getToken() {
  return process.env.GITLAB_TOKEN || process.env.GL_TOKEN || null;
}

function authHeaders() {
  const headers = {};
  const token = getToken();
  if (token) headers['PRIVATE-TOKEN'] = token;
  return headers;
}

/**
 * Fetch a file from the GitLab Files API (raw).
 * @param {object} entry
 * @param {string} ref - branch, tag or commit
 * @param {string} filePath - path within the repo
 * @returns {Promise<string|null>} file contents or null if not found
 */
export async function fetchRawFile(entry, ref, filePath) {
  const url = `${getBaseUrl(entry)}/api/v4/projects/${getProjectId(entry)}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${encodeURIComponent(ref)}`;
  const res = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  return res.text();
}

/**
 * Fetch and parse a JSON file from GitLab.
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
 * Resolve a project's default branch (falls back to "main").
 * @param {object} entry
 * @returns {Promise<string>}
 */
export async function getDefaultBranch(entry) {
  const url = `${getBaseUrl(entry)}/api/v4/projects/${getProjectId(entry)}`;
  const res = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(10000) });
  if (!res.ok) return 'main';
  const data = await res.json();
  return data.default_branch || 'main';
}

/**
 * List files in a GitLab directory using the Repository Trees API, paginating
 * through every page. Returns { path, type } with repo-relative paths.
 * @param {object} entry
 * @param {string} ref
 * @param {string} dirPath - directory path within the repo (may be empty for root)
 * @returns {Promise<Array<{path: string, type: string}>>}
 */
export async function listDirectory(entry, ref, dirPath) {
  const headers = authHeaders();
  const items = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams({ ref, recursive: 'true', per_page: '100', page: String(page) });
    if (dirPath) params.set('path', dirPath);

    const url = `${getBaseUrl(entry)}/api/v4/projects/${getProjectId(entry)}/repository/tree?${params.toString()}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`GitLab API error: ${res.status}`);

    const batch = await res.json();
    items.push(...batch);
    if (batch.length < 100) break;
    page++;
  }

  return items.map(item => ({
    path: item.path,
    type: item.type, // "blob" or "tree"
  }));
}
