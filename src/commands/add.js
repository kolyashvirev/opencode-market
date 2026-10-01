import chalk from 'chalk';
import { parseSource, getProviderFor } from '../utils/provider.js';
import { setMarketplace } from '../utils/registry.js';
import { header, success, error, info } from '../utils/exec.js';

const MARKETPLACE_PATHS = [
  '.github/plugin/marketplace.json',
  '.claude-plugin/marketplace.json',
  'marketplace.json',
];

/**
 * Add a marketplace from a GitHub or GitLab repo.
 * @param {string} sourceInput - "owner/repo", a repo URL, or a GitLab path
 * @param {{ gitlab?: boolean, github?: boolean, host?: string, http?: boolean, https?: boolean }} options
 */
export async function runAdd(sourceInput, options = {}) {
  header('Adding marketplace');

  let target;
  try {
    target = parseSource(sourceInput, options);
  } catch (err) {
    error(err.message);
    return;
  }

  const provider = getProviderFor(target);
  const location = target.transport === 'ssh'
    ? `git@${target.host}:${target.project}.git (ssh)`
    : (target.provider === 'github'
      ? `${target.project} (github)`
      : `${target.host}/${target.project} (${target.scheme})`);

  info(`Searching for marketplace.json in ${location}...`);

  const ref = await provider.getDefaultBranch(target);
  info(`Using ref: ${ref}`);

  let marketplace = null;
  let sourcePath = null;

  for (const candidate of MARKETPLACE_PATHS) {
    try {
      const data = await provider.fetchJsonFile(target, ref, candidate);
      if (data && data.name) {
        marketplace = data;
        sourcePath = candidate;
        break;
      }
    } catch {
      // try next path
    }
  }

  if (!marketplace) {
    error(`Could not find marketplace.json in ${location}`);
    info('Tried paths:');
    for (const p of MARKETPLACE_PATHS) info(`  ${p}`);
    return;
  }

  info(`Found at ${sourcePath}`);

  await setMarketplace(marketplace.name, {
    provider: target.provider,
    transport: target.transport,
    host: target.host,
    scheme: target.scheme,
    repo: target.project,
    project: target.project,
    ref,
    source: sourcePath,
    installed: [],
  });

  success(`Registered marketplace: ${chalk.bold(marketplace.name)}`);

  if (marketplace.plugins?.length) {
    info(`Available plugins:`);
    for (const plugin of marketplace.plugins) {
      info(`  ${plugin.name} v${plugin.version} — ${plugin.description || ''}`);
    }
  }
}
