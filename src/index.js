#!/usr/bin/env node
import chalk from 'chalk';
import { createRequire } from 'node:module';
import { runAdd } from './commands/add.js';
import { runInstall } from './commands/install.js';
import { runUpdate } from './commands/update.js';
import { runList } from './commands/list.js';
import { cleanup as cleanupGitCheckouts } from './utils/git.js';

function printHelp(version) {
  console.log(`opencode-market v${version}`);
  console.log();
  console.log('Usage:');
  console.log('  npx opencode-market <command> [args] [options]');
  console.log();
  console.log('Commands:');
  console.log('  add <source>              Register a marketplace (GitHub or GitLab)');
  console.log('  install <plugin>@<market>  Install a plugin from a registered marketplace');
  console.log('  update <marketplace>       Re-download all installed plugins for a marketplace');
  console.log('  list                       List registered marketplaces and installed plugins');
  console.log();
  console.log('Source formats (add):');
  console.log('  owner/repo                       GitHub (default, over API)');
  console.log('  github.com/owner/repo            GitHub');
  console.log('  gitlab.com/group[/sub]/project   GitLab (host auto-detected)');
  console.log('  https://gitlab.local/group/repo  Self-hosted GitLab (full URL)');
  console.log('  git@gitlab.local:group/repo.git  Git/GitLab over SSH (key auth)');
  console.log('  ssh://git@host/group/repo        Git over SSH');
  console.log();
  console.log('Options:');
  console.log('  --local                   Install to ./.agents/ (project) instead of ~/.agents/ (global)');
  console.log('  --opencode                Install to ./.opencode/ (opencode project folder)');
  console.log('  --gitlab                  Treat a bare source as a GitLab project');
  console.log('  --github                  Force GitHub provider');
  console.log('  --ssh                     Use git-over-SSH transport (SSH key auth, no token)');
  console.log('  --host <host>             GitLab host[:port] or URL (also GITLAB_HOST env)');
  console.log('  --http                    Use http:// for the GitLab host (default: https)');
  console.log('  -h, --help                Show this help message');
  console.log();
  console.log('Auth:');
  console.log('  GitHub API: GITHUB_TOKEN env var or authenticated `gh` CLI');
  console.log('  GitLab API: GITLAB_TOKEN (or GL_TOKEN) env var, sent as PRIVATE-TOKEN');
  console.log('  SSH:        uses your SSH keys / ssh-agent (GIT_SSH_COMMAND respected)');
}

function parseArgs(argv) {
  const options = { local: false, opencode: false, gitlab: false, github: false, host: null, http: false, ssh: false };
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--local': options.local = true; break;
      case '--opencode': options.opencode = true; break;
      case '--gitlab': case '--gl': options.gitlab = true; break;
      case '--github': case '--gh': options.github = true; break;
      case '--ssh': options.ssh = true; break;
      case '--host': options.host = argv[++i] ?? null; break;
      case '--http': options.http = true; break;
      default:
        if (!a.startsWith('-')) positional.push(a);
    }
  }

  return { options, positional };
}

const require = createRequire(import.meta.url);
const { version } = require('../package.json');
const args = process.argv.slice(2);

if (args.includes('-h') || args.includes('--help') || args.length === 0) {
  printHelp(version);
  process.exit(0);
}

const { options, positional } = parseArgs(args);
const command = positional[0];
const arg = positional[1];

try {
  switch (command) {
    case 'add':
      if (!arg) {
        console.log(chalk.red('Missing argument: <source>'));
        console.log('Usage: npx opencode-market add <owner/repo> [--gitlab --host <host>]');
        process.exit(1);
      }
      await runAdd(arg, options);
      break;

    case 'install':
      if (!arg) {
        console.log(chalk.red('Missing argument: plugin@marketplace'));
        console.log('Usage: npx opencode-market install <plugin>@<marketplace>');
        process.exit(1);
      }
      await runInstall(arg, options);
      break;

    case 'update':
      if (!arg) {
        console.log(chalk.red('Missing argument: marketplace name'));
        console.log('Usage: npx opencode-market update <marketplace>');
        process.exit(1);
      }
      await runUpdate(arg, options);
      break;

    case 'list':
      await runList();
      break;

    default:
      console.log(chalk.red(`Unknown command: ${command}`));
      console.log();
      printHelp(version);
      process.exit(1);
  }
} catch (err) {
  if (err.name === 'ExitPromptError') {
    console.log();
    console.log(chalk.yellow('Cancelled.'));
  } else {
    console.error(chalk.red('\nUnexpected error:'), err.message);
    await cleanupGitCheckouts();
    process.exit(1);
  }
}

await cleanupGitCheckouts();
