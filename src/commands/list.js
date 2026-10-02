import chalk from 'chalk';
import { readRegistries } from '../utils/registry.js';
import { entryTarget, getProviderFor } from '../utils/provider.js';
import { header, info, error, warn } from '../utils/exec.js';

/**
 * List registered marketplaces and their installed plugins.
 *
 * With `options.available`, additionally fetch each marketplace's manifest and
 * list every plugin/skill it exposes for installation, marking the ones that
 * are already installed.
 *
 * @param {string} [marketplaceName] - restrict the output to a single marketplace
 * @param {{ available?: boolean }} options
 */
export async function runList(marketplaceName, options = {}) {
  const registries = await readRegistries();
  let names = Object.keys(registries);

  if (names.length === 0) {
    header('Registered marketplaces');
    info('No marketplaces registered yet');
    info('Run: npx opencode-market add <owner/repo>');
    return;
  }

  if (marketplaceName) {
    if (!registries[marketplaceName]) {
      header('Registered marketplaces');
      error(`Marketplace "${marketplaceName}" is not registered`);
      info(`Known: ${names.join(', ')}`);
      return;
    }
    names = [marketplaceName];
  }

  header(marketplaceName ? `Marketplace: ${marketplaceName}` : 'Registered marketplaces');

  for (const name of names) {
    const entry = registries[name];
    const provider = entry.provider || 'github';
    const transport = entry.transport || 'api';

    console.log();
    console.log(chalk.bold(name));
    info(`provider: ${provider} (${transport})`);
    if (transport === 'ssh') {
      info(`remote: git@${entry.host}:${entry.project || entry.repo}.git`);
    } else if (provider === 'gitlab') {
      info(`host: ${entry.scheme || 'https'}://${entry.host}`);
    }
    info(`repo: ${entry.project || entry.repo}`);
    info(`ref: ${entry.ref}`);
    info(`source: ${entry.source}`);

    const installed = entry.installed || [];
    if (installed.length === 0) {
      info('installed: (none)');
    } else {
      info(`installed: ${installed.join(', ')}`);
    }

    if (options.available) {
      await printAvailable(name, entry, installed);
    }
  }
}

/**
 * Fetch a marketplace manifest and print the plugins/skills it exposes.
 * @param {string} name
 * @param {object} entry
 * @param {string[]} installed
 */
async function printAvailable(name, entry, installed) {
  info('available plugins:');
  try {
    const target = entryTarget(entry);
    const provider = getProviderFor(target);
    const marketplace = await provider.fetchJsonFile(target, entry.ref, entry.source);
    const plugins = marketplace?.plugins || [];

    if (plugins.length === 0) {
      info('  (none)');
      return;
    }

    for (const plugin of plugins) {
      const mark = installed.includes(plugin.name) ? chalk.green('✓ ') : chalk.dim('  ');
      const version = plugin.version ? ` v${plugin.version}` : '';
      const desc = plugin.description ? chalk.dim(` — ${plugin.description}`) : '';
      console.log(`  ${mark}${chalk.bold(plugin.name)}${version}${desc}`);
    }
    info('  (✓ = installed)');
  } catch (err) {
    warn(`Could not fetch available plugins for "${name}": ${err.message}`);
  }
}
