import fse from 'fs-extra';
import os from 'os';
import path from 'path';
import { getProviderFor } from './provider.js';
import { info, success } from './exec.js';

// Folders a Claude-style plugin auto-exposes when the manifest doesn't name them.
const STANDARD_PLUGIN_DIRS = ['agents', 'commands', 'skills'];

// Candidate locations of a plugin.json, relative to a plugin directory.
const MANIFEST_SUBPATHS = ['plugin.json', '.claude-plugin/plugin.json', '.github/plugin/plugin.json'];

/**
 * Resolve the base directory for installing agents/skills.
 *
 * --opencode            →  <cwd>/.opencode/
 * --local               →  <cwd>/.agents/
 * (default, global)     →  ~/.agents/
 *
 * --opencode takes priority over --local when both are passed.
 *
 * @param {{ local?: boolean, opencode?: boolean }} options
 * @returns {string}
 */
export function resolveInstallBase(options = {}) {
  if (options.opencode) return path.join(process.cwd(), '.opencode');
  if (options.local) return path.join(process.cwd(), '.agents');
  return path.join(os.homedir(), '.agents');
}

/**
 * Install a plugin by downloading its component folders.
 *
 * If the manifest declares `agents` / `skills` / `commands` paths those are
 * used verbatim. Otherwise — the standard Claude-plugin convention, where a
 * plugin directory auto-exposes top-level `agents/`, `commands/` and `skills/`
 * folders — is auto-detected by probing the plugin directory.
 *
 * @param {{ provider: string, project: string, host?: string, scheme?: string }} entry - provider descriptor
 * @param {string} ref - branch or tag
 * @param {string} pluginSource - plugin base dir within the repo (e.g. "checklist-review")
 * @param {object} pluginJson - parsed plugin.json
 * @param {{ local?: boolean, opencode?: boolean }} options
 */
export async function installPlugin(entry, ref, pluginSource, pluginJson, options = {}) {
  const provider = getProviderFor(entry);
  const base = resolveInstallBase(options);
  // Normalise: root plugin has pluginSource '' or '.' — both mean no prefix
  const prefix = (!pluginSource || pluginSource === '.') ? '' : `${pluginSource.replace(/\/+$/, '')}/`;

  const dirs = await resolveComponentDirs(provider, entry, ref, prefix, pluginJson);
  for (const [remotePath, localName] of dirs) {
    await downloadFolder(provider, entry, ref, remotePath, path.join(base, localName));
  }

  info(`Installed to: ${base}`);
}

// Maps remote (repo-relative) folder -> local destination subfolder.
async function resolveComponentDirs(provider, entry, ref, prefix, pluginJson) {
  const dirs = new Map();

  if (pluginJson.agents) dirs.set(normalizePath(`${prefix}${pluginJson.agents}`), 'agents');
  if (pluginJson.skills) dirs.set(normalizePath(`${prefix}${pluginJson.skills}`), 'skills');
  if (pluginJson.commands) dirs.set(normalizePath(`${prefix}${pluginJson.commands}`), 'commands');
  if (dirs.size > 0) return dirs;

  // Auto-detect the standard Claude-plugin folders under the plugin directory.
  for (const name of STANDARD_PLUGIN_DIRS) {
    const remote = normalizePath(prefix ? `${prefix}${name}` : name);
    const items = await provider.listDirectory(entry, ref, remote);
    if (items.some(i => i.type === 'blob')) dirs.set(remote, name);
  }
  return dirs;
}

/**
 * Download all files from a remote directory into a local destination,
 * preserving the directory structure relative to the source folder.
 */
function normalizePath(p) {
  return p.replace(/\/+/g, '/').replace(/\/\.\//g, '/').replace(/\/\.$/, '').replace(/^\//, '');
}

function getAlternatePath(remotePath) {
  const normalized = remotePath.replace(/\/+$/, '');
  const lastSegment = normalized.split('/').pop();
  if (lastSegment.startsWith('.')) {
    return normalized.replace(new RegExp(`\\.${escapeRegExp(lastSegment.slice(1))}$`), lastSegment.slice(1));
  }
  return normalized.replace(new RegExp(`${escapeRegExp(lastSegment)}$`), `.${  lastSegment}`);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function downloadFolder(provider, entry, ref, remotePath, localBase) {
  const normalizedRemote = remotePath.replace(/\/+$/, '');
  let items = await provider.listDirectory(entry, ref, normalizedRemote);
  let blobs = items.filter(i => i.type === 'blob');

  if (blobs.length === 0) {
    const alternate = getAlternatePath(normalizedRemote);
    if (alternate !== normalizedRemote) {
      info(`No files found in ${normalizedRemote}, trying ${alternate}...`);
      items = await provider.listDirectory(entry, ref, alternate);
      blobs = items.filter(i => i.type === 'blob');
      if (blobs.length > 0) {
        return downloadToDisk(provider, entry, ref, alternate, blobs, localBase);
      }
    }
    info(`No files found in ${normalizedRemote}`);
    return;
  }

  return downloadToDisk(provider, entry, ref, normalizedRemote, blobs, localBase);
}

async function downloadToDisk(provider, entry, ref, normalizedRemote, blobs, localBase) {
  for (const blob of blobs) {
    const relativePath = blob.path.slice(normalizedRemote.length + 1);
    const localPath = path.join(localBase, relativePath);

    const content = await provider.fetchRawFile(entry, ref, blob.path);
    if (content == null) continue;

    await fse.ensureDir(path.dirname(localPath));
    await fse.writeFile(localPath, content, 'utf-8');
    info(relativePath);
  }

  success(`Downloaded ${blobs.length} file(s) from ${normalizedRemote}`);
}

/**
 * Resolve a plugin.json from its source path within the repo.
 * Probes a set of standard manifest locations (root, .claude-plugin/, .github/plugin/)
 * under the plugin directory, trying repo-root-relative first and then relative
 * to the directory containing marketplace.json.
 * @param {object} entry - provider descriptor
 * @param {string} ref
 * @param {string} marketplaceSource - the source path from marketplace.json (e.g. ".claude-plugin/marketplace.json")
 * @param {string} pluginSourceRelative - the plugin's source field (e.g. "./checklist-review")
 * @returns {Promise<{pluginJson: object, pluginBasePath: string}|null>}
 */
export async function fetchPluginJson(entry, ref, marketplaceSource, pluginSourceRelative) {
  const provider = getProviderFor(entry);
  // Normalise source: strip leading "./" so path.posix.join works cleanly
  const normalised = pluginSourceRelative.replace(/^\.\//, '').replace(/\/+$/, '');

  // Candidate base directories for the plugin: repo-root relative, then
  // relative to the directory containing marketplace.json.
  const candidateDirs = [normalised];
  const marketplaceDir = path.posix.dirname(marketplaceSource);
  const relDir = path.posix.join(marketplaceDir, normalised).replace(/\/+$/, '');
  if (relDir !== '.' && relDir !== normalised) candidateDirs.push(relDir);

  for (const dir of candidateDirs) {
    for (const sub of MANIFEST_SUBPATHS) {
      const p = dir ? `${dir}/${sub}` : sub;
      const data = await provider.fetchJsonFile(entry, ref, p);
      if (data && typeof data === 'object') {
        return { pluginJson: data, pluginBasePath: dir };
      }
    }
  }

  return null;
}
