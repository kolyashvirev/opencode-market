# opencode-market

CLI to discover, install, and manage opencode agent plugins from GitHub **or GitLab** marketplaces (gitlab.com and self-hosted instances). The goal of this tool is to never exist but meanwhile Opencode has no an official market I need a tool to install agents and skills from my private repos https://github.com/anomalyco/opencode/issues/7467#issuecomment-4407270984

## Usage

```bash
npx opencode-market add <source> [--gitlab] [--host <host>] [--http]
npx opencode-market install <plugin>@<marketplace> [--local] [--opencode]
npx opencode-market update <marketplace> [--local] [--opencode]
npx opencode-market list [--available] [<marketplace>]
```

## Commands

### `add <source>`

Register a marketplace from a GitHub or GitLab repo. The provider is auto-detected from the source:

```bash
# GitHub (default)
npx opencode-market add anomalyco/opencode
npx opencode-market add github.com/anomalyco/opencode

# GitLab — gitlab.com (nested groups supported)
npx opencode-market add gitlab.com/group/subgroup/project

# Self-hosted GitLab — full URL (REST API)
npx opencode-market add https://gitlab.local/group/project
npx opencode-market add http://gitlab.local:8080/group/project   # plain HTTP

# Bare path forced onto a GitLab host
npx opencode-market add group/project --gitlab --host gitlab.local

# SSH transport (git clone over SSH keys — no API token needed)
npx opencode-market add git@gitlab.local:group/project.git
npx opencode-market add ssh://git@gitlab.local/group/project
npx opencode-market add group/project --gitlab --ssh --host gitlab.local
```

For SSH sources the tool shallow-clones the repo over SSH (`git@host:group/project.git`) using your SSH keys / ssh-agent, then reads plugins from the checkout. It never prompts for a password (`ssh -o BatchMode=yes`); customize the SSH invocation via `GIT_SSH_COMMAND` if needed.

Searches for `marketplace.json` in:
1. `.github/plugin/marketplace.json`
2. `.claude-plugin/marketplace.json`
3. `marketplace.json` (root)

The repo's default branch is resolved automatically (GitHub/GitLab API, or `git ls-remote` over SSH).

### `install <plugin>@<marketplace>`

Install a plugin from a registered marketplace. By default installs globally to `~/.agents/`.

```bash
# Global (default) — available to all projects
npx opencode-market install proposals@plainpresales

# Project-local — installs to ./.agents/
npx opencode-market install proposals@plainpresales --local

# OpenCode project folder — installs to ./.opencode/
npx opencode-market install proposals@plainpresales --opencode
```

### `update <marketplace>`

Re-download all installed plugins for a marketplace. Fetches the latest files from GitHub for each plugin already recorded in `~/.opencode-market/registries.json`. Accepts the same `--local` and `--opencode` flags as `install`.

### `list`

Print all registered marketplaces and their installed plugins.

```bash
# Registered marketplaces + installed plugins
npx opencode-market list

# Also list every plugin/skill available to install (✓ marks installed ones)
npx opencode-market list --available

# Restrict to a single marketplace
npx opencode-market list <marketplace> --available
```

## Install destinations

| Flag | Agents | Skills |
|------|--------|--------|
| *(default)* | `~/.agents/agents/` | `~/.agents/skills/` |
| `--local` | `./.agents/agents/` | `./.agents/skills/` |
| `--opencode` | `./.opencode/agents/` | `./.opencode/skills/` |

## Authentication

- **GitHub (API)**: set `GITHUB_TOKEN` env var or have `gh` CLI authenticated.
- **GitLab (API)** (gitlab.com or self-hosted): set `GITLAB_TOKEN` (or `GL_TOKEN`) to a personal/project access token with `read_api` / `read_repository` scope. It is sent as the `PRIVATE-TOKEN` header. Public projects work without a token. You can also set `GITLAB_HOST` to default the GitLab host for `--gitlab` sources.
- **SSH transport** (`--ssh`, `git@…`, `ssh://…`): no token. The tool shells out to `git` over SSH, so access is granted by the SSH keys your agent/`~/.ssh` provides. Add your deploy key to the GitLab project. `BatchMode=yes` is used so key-only auth never hangs on a password prompt; override via `GIT_SSH_COMMAND`.

## License

MIT
