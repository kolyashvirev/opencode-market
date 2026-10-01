import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseSource, entryTarget, getProviderFor } from './provider.js';

describe('parseSource', () => {
  const savedHost = process.env.GITLAB_HOST;

  beforeEach(() => { delete process.env.GITLAB_HOST; });
  afterEach(() => {
    if (savedHost === undefined) delete process.env.GITLAB_HOST;
    else process.env.GITLAB_HOST = savedHost;
  });

  it('defaults bare owner/repo to github', () => {
    expect(parseSource('anomalyco/opencode')).toEqual({
      provider: 'github', host: 'github.com', scheme: 'https', project: 'anomalyco/opencode', transport: 'api',
    });
  });

  it('detects github.com host without scheme', () => {
    expect(parseSource('github.com/owner/repo').provider).toBe('github');
  });

  it('parses a full gitlab.com URL as gitlab', () => {
    const r = parseSource('https://gitlab.com/group/subgroup/project');
    expect(r).toEqual({ provider: 'gitlab', host: 'gitlab.com', scheme: 'https', project: 'group/subgroup/project', transport: 'api' });
  });

  it('parses self-hosted gitlab URL with custom port + http', () => {
    const r = parseSource('http://gitlab.local:8080/team/repo');
    expect(r).toEqual({ provider: 'gitlab', host: 'gitlab.local:8080', scheme: 'http', project: 'team/repo', transport: 'api' });
  });

  it('uses --gitlab with GITLAB_HOST for a bare path', () => {
    process.env.GITLAB_HOST = 'git.internal';
    const r = parseSource('group/proj', { gitlab: true });
    expect(r).toEqual({ provider: 'gitlab', host: 'git.internal', scheme: 'https', project: 'group/proj', transport: 'api' });
  });

  it('--gitlab --host accepts a scheme and --http overrides to http', () => {
    const r = parseSource('grp/proj', { gitlab: true, host: 'http://gl.in', http: true });
    expect(r).toEqual({ provider: 'gitlab', host: 'gl.in', scheme: 'http', project: 'grp/proj', transport: 'api' });
  });

  it('throws on empty project (URL with host but no path)', () => {
    expect(() => parseSource('https://gitlab.com')).toThrow();
    expect(() => parseSource('   ')).toThrow();
  });

  it('parses scp-like git@ SSH url as ssh transport', () => {
    const r = parseSource('git@gitlab.local:group/sub/project.git');
    expect(r).toEqual({
      provider: 'gitlab', host: 'gitlab.local', scheme: 'https',
      project: 'group/sub/project', transport: 'ssh',
    });
  });

  it('parses ssh:// URL (with port) as ssh transport', () => {
    const r = parseSource('ssh://git@git.example.com:2222/team/repo.git');
    expect(r).toMatchObject({ host: 'git.example.com:2222', project: 'team/repo', transport: 'ssh' });
  });

  it('--ssh with a bare path + --host forces ssh transport', () => {
    const r = parseSource('group/proj', { gitlab: true, ssh: true, host: 'git.internal' });
    expect(r).toMatchObject({ provider: 'gitlab', host: 'git.internal', project: 'group/proj', transport: 'ssh' });
  });

  it('replaces https URL host but keeps path when --ssh is passed', () => {
    const r = parseSource('https://gitlab.local/group/repo.git', { ssh: true });
    expect(r).toMatchObject({ host: 'gitlab.local', project: 'group/repo', transport: 'ssh' });
  });
});

describe('entryTarget', () => {
  it('assumes github for legacy entries without provider', () => {
    expect(entryTarget({ repo: 'owner/repo' })).toMatchObject({ provider: 'github', project: 'owner/repo' });
  });

  it('prefers project field over repo', () => {
    expect(entryTarget({ provider: 'gitlab', host: 'g.local', project: 'g/s/r', repo: 'ignored' }))
      .toMatchObject({ provider: 'gitlab', project: 'g/s/r', host: 'g.local' });
  });
});

describe('getProviderFor', () => {
  it('returns gitlab module only for gitlab', () => {
    expect(getProviderFor({ provider: 'gitlab' })).toHaveProperty('listDirectory');
    expect(getProviderFor({ provider: 'github' })).toBe(getProviderFor({ provider: 'anything-else' }));
  });

  it('returns the git (ssh) module whenever transport is ssh', () => {
    const sshGitlab = getProviderFor({ provider: 'gitlab', transport: 'ssh' });
    const sshGithub = getProviderFor({ provider: 'github', transport: 'ssh' });
    expect(sshGitlab).toBe(sshGithub);
    expect(sshGitlab).toHaveProperty('cleanup');
    expect(sshGitlab).not.toBe(getProviderFor({ provider: 'gitlab' }));
  });
});
