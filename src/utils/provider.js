import * as githubProvider from './github.js';
import * as gitlabProvider from './gitlab.js';
import * as gitProvider from './git.js';

/**
 * Return the provider module for a descriptor/entry.
 * When `transport` is "ssh", the git-over-SSH provider is used regardless of
 * host (works for both GitLab and GitHub); otherwise the REST provider is
 * chosen from `provider` ("github" | "gitlab").
 * @param {{ provider?: string, transport?: string }} target
 */
export function getProviderFor(target = {}) {
  if (target.transport === 'ssh') return gitProvider;
  if (target.provider === 'gitlab') return gitlabProvider;
  return githubProvider;
}

function detectProvider(host, forced) {
  if (forced) return forced;
  const h = host.toLowerCase();
  if (h === 'github.com' || h.endsWith('.github.com')) return 'github';
  return 'gitlab';
}

// Split a possibly-scheme-prefixed host string into { scheme, host }.
function splitHost(raw) {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) {
    const u = new URL(trimmed);
    return { scheme: u.protocol.replace(':', '').toLowerCase(), host: u.host };
  }
  return { scheme: null, host: trimmed.toLowerCase() };
}

const stripGit = (p) => p.replace(/\.git$/, '').replace(/^\/+|\/+$/g, '');

/**
 * Parse a user-supplied marketplace source into a provider descriptor.
 *
 * Supported inputs:
 *   owner/repo                              -> github over API (default, back-compat)
 *   github.com/owner/repo                    -> github over API
 *   gitlab.com/group/subgroup/project        -> gitlab over API
 *   https://gitlab.local/group/project        -> gitlab over API (self-hosted)
 *   git@gitlab.local:group/project.git        -> gitlab over SSH (key auth)
 *   ssh://git@host/group/project             -> git over SSH
 *   --ssh  (with a path or URL)               -> force SSH transport
 *   --gitlab (with owner/repo or group/proj)  -> gitlab (host from --host/GITLAB_HOST/gitlab.com)
 *
 * @param {string} input
 * @param {{ gitlab?: boolean, github?: boolean, host?: string, http?: boolean, https?: boolean, ssh?: boolean }} options
 * @returns {{ provider: string, host: string, scheme: string, project: string, transport: string }}
 */
export function parseSource(input, options = {}) {
  const forced = options.gitlab ? 'gitlab' : (options.github ? 'github' : null);
  let scheme = options.http ? 'http' : (options.https ? 'https' : null);
  let transport = options.ssh ? 'ssh' : 'api';
  let host = null;
  let project = null;

  if (/^git@[^:]+:/i.test(input)) {
    // scp-like SSH URL: git@host:group/project(.git)
    transport = 'ssh';
    const m = input.match(/^git@([^:]+):(.+)$/i);
    host = m[1].toLowerCase();
    project = stripGit(m[2]);
  } else if (/^ssh:\/\//i.test(input)) {
    // ssh://git@host[:port]/group/project(.git)
    transport = 'ssh';
    const u = new URL(input);
    host = u.host;
    project = stripGit(u.pathname);
  } else if (/^https?:\/\//i.test(input)) {
    const u = new URL(input);
    host = u.host;
    if (!scheme) scheme = u.protocol.replace(':', '').toLowerCase();
    project = stripGit(u.pathname);
  } else {
    const segs = input.split('/').map(s => s.trim()).filter(Boolean);
    const firstIsHost = segs.length > 1 && segs[0].includes('.');

    if (firstIsHost) {
      const parsed = splitHost(segs[0]);
      host = parsed.host;
      if (!scheme) scheme = parsed.scheme;
      project = segs.slice(1).join('/');
    } else if (forced === 'gitlab') {
      const parsed = splitHost(options.host || process.env.GITLAB_HOST || 'gitlab.com');
      host = parsed.host;
      if (!scheme) scheme = parsed.scheme;
      project = segs.join('/');
    } else if (transport === 'ssh' && (options.host || process.env.GITLAB_HOST)) {
      // bare path with --ssh against a custom host
      host = splitHost(options.host || process.env.GITLAB_HOST).host;
      project = segs.join('/');
    } else {
      host = 'github.com';
      project = segs.join('/');
    }
  }

  if (!host || !project) {
    throw new Error(`Invalid source: ${input}. Expected owner/repo, a repo URL, or git@host:group/project.git`);
  }

  return {
    provider: detectProvider(host, forced),
    host,
    scheme: scheme || 'https',
    project: project.replace(/\/+$/, ''),
    transport,
  };
}

/**
 * Build a provider descriptor from a stored registry entry.
 * Back-compatible with older entries that only stored { repo } (assumed GitHub over API).
 * @param {object} entry
 * @returns {{ provider: string, host?: string, scheme?: string, project: string, transport: string }}
 */
export function entryTarget(entry) {
  return {
    provider: entry.provider || 'github',
    host: entry.host,
    scheme: entry.scheme,
    project: entry.project || entry.repo,
    transport: entry.transport || 'api',
  };
}
