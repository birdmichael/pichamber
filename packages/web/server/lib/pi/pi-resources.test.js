import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  listPiCommands,
  listPiSkills,
  getPiSkillDetail,
  parseMarkdownFrontmatter,
  readPiDefaults,
  writePiDefaults,
  writePiPrompt,
  deletePiPrompt,
  getPiAuthMethods,
  getPiProviderSources,
  listPiProviderPublicConfigs,
  writePiProviderAuth,
  removePiProviderAuth,
  upsertPiProviderConfig,
  deletePiProviderConfig,
  listPiExtensions,
  listPiPackages,
  filterProvidersByEnabledModels,
  resolvePiDefaultModel,
  readPiProjectTrust,
  writePiProjectTrust,
  setPiProjectTrust,
  resolveBehaviorAgentsMd,
  resolveProjectAgentsMd,
  readBehaviorAgentsMd,
  resolvePiAgentsMdPath,
  toConfigSkillsPayload,
} from './pi-resources.js';

const tempDirs = [];

const makeTemp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-resources-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('pi-resources', () => {
  it('parses skill frontmatter', () => {
    const parsed = parseMarkdownFrontmatter('---\ndescription: Review diffs\n---\nLook at the change.');
    expect(parsed.attributes.description).toBe('Review diffs');
    expect(parsed.body).toBe('Look at the change.');
  });

  it('parses YAML block scalar skill descriptions instead of storing "|"', () => {
    const parsed = parseMarkdownFrontmatter(`---
name: claude-to-im
description: |
  This skill bridges Claude Code to IM platforms.
  Second line stays in the blurb.
---
Use this skill to relay messages.
`);
    expect(parsed.attributes.name).toBe('claude-to-im');
    expect(parsed.attributes.description).not.toBe('|');
    expect(parsed.attributes.description).toContain('This skill bridges Claude Code to IM platforms.');
    expect(parsed.attributes.description).toContain('Second line stays in the blurb.');
    expect(parsed.body).toBe('Use this skill to relay messages.');
  });

  it('parses folded YAML descriptions and keeps quoted single-line values', () => {
    const folded = parseMarkdownFrontmatter(`---
description: >
  Folded
  into one line.
---
`);
    expect(folded.attributes.description).not.toBe('>');
    expect(folded.attributes.description).toMatch(/Folded into one line/);

    const quoted = parseMarkdownFrontmatter('---\ndescription: "Hello: world"\n---\nBody.\n');
    expect(quoted.attributes.description).toBe('Hello: world');
    expect(quoted.body).toBe('Body.');
  });

  it('lists Pi skills and prompt commands from conventional directories', () => {
    const home = makeTemp();
    const project = makeTemp();
    fs.mkdirSync(path.join(home, '.pi', 'agent', 'skills', 'review'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.pi', 'agent', 'skills', 'review', 'SKILL.md'),
      '---\ndescription: Review code\n---\nReview carefully.\n',
    );
    fs.mkdirSync(path.join(home, '.pi', 'agent', 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(home, '.pi', 'agent', 'prompts', 'ship.md'), 'Prepare the change for review.');
    fs.mkdirSync(path.join(project, '.pi', 'skills', 'local'), { recursive: true });
    fs.writeFileSync(path.join(project, '.pi', 'skills', 'local', 'SKILL.md'), '---\ndescription: Local skill\n---\n');

    fs.mkdirSync(path.join(home, '.agents', 'skills', 'claude-to-im'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.agents', 'skills', 'claude-to-im', 'SKILL.md'),
      '---\nname: claude-to-im\ndescription: |\n  This skill bridges Claude Code to IM platforms.\n---\nRelay the message.\n',
    );

    const skills = listPiSkills({ home, directory: project });
    expect(skills.map((skill) => skill.name).sort()).toEqual(['claude-to-im', 'local', 'review']);
    expect(skills.find((skill) => skill.name === 'review').scope).toBe('user');
    expect(skills.find((skill) => skill.name === 'local').scope).toBe('project');
    expect(skills.find((skill) => skill.name === 'claude-to-im').description).toContain(
      'This skill bridges Claude Code to IM platforms.',
    );
    expect(skills.find((skill) => skill.name === 'claude-to-im').description).not.toBe('|');

    const commands = listPiCommands({ home, directory: project });
    expect(commands.some((command) => command.name === 'compact' && command.source === 'builtin')).toBe(true);
    expect(commands.some((command) => command.name === 'login' && command.source === 'builtin')).toBe(true);
    expect(commands.some((command) => command.name === 'model')).toBe(false);
    expect(commands.some((command) => command.name === 'thinking')).toBe(false);
    expect(commands.some((command) => command.name === 'ship' && command.template.includes('Prepare the change'))).toBe(true);
  });

  it('follows skill directory symlinks, finds nested SKILL.md, and does not hang on cycles', () => {
    const home = makeTemp();
    const project = makeTemp();
    const realSkills = path.join(home, 'codex', 'superpowers', 'skills');
    fs.mkdirSync(path.join(realSkills, 'brainstorming'), { recursive: true });
    fs.writeFileSync(
      path.join(realSkills, 'brainstorming', 'SKILL.md'),
      '---\nname: brainstorming\ndescription: Brainstorm approaches\n---\n',
    );
    fs.mkdirSync(path.join(realSkills, 'nested', 'debugging'), { recursive: true });
    fs.writeFileSync(
      path.join(realSkills, 'nested', 'debugging', 'SKILL.md'),
      '---\nname: debugging\ndescription: Debug a failure\n---\n',
    );
    fs.symlinkSync(realSkills, path.join(realSkills, 'loop'));
    fs.mkdirSync(path.join(home, '.agents', 'skills'), { recursive: true });
    fs.symlinkSync(realSkills, path.join(home, '.agents', 'skills', 'superpowers'));
    fs.symlinkSync(path.join(home, 'missing-skill-pack'), path.join(home, '.agents', 'skills', 'broken'));

    const started = Date.now();
    const skills = listPiSkills({ home, directory: project });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(skills.map((skill) => skill.name).sort()).toEqual(['brainstorming', 'debugging']);
    expect(skills.every((skill) => skill.scope === 'user')).toBe(true);
  });

  it('returns YAML block description and body for a nested symlink skill without rewriting the file', () => {
    const home = makeTemp();
    const project = makeTemp();
    const realSkills = path.join(home, 'codex', 'superpowers', 'skills');
    const skillDir = path.join(realSkills, 'brainstorming');
    const skillPath = path.join(skillDir, 'SKILL.md');
    const original = [
      '---',
      'name: brainstorming',
      'description: |',
      '  This skill brainstorms approaches.',
      '  Second line stays in the blurb.',
      '---',
      '',
      'Ask clarifying questions first.',
      '',
    ].join('\n');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(skillPath, original, 'utf8');
    fs.mkdirSync(path.join(home, '.agents', 'skills'), { recursive: true });
    fs.symlinkSync(realSkills, path.join(home, '.agents', 'skills', 'superpowers'));

    const skills = listPiSkills({ home, directory: project });
    const listed = skills.find((skill) => skill.name === 'brainstorming');
    expect(listed).toBeTruthy();
    expect(listed.path).toBe(path.join(home, '.agents', 'skills', 'superpowers', 'brainstorming', 'SKILL.md'));
    expect(listed.description).toContain('This skill brainstorms approaches.');
    expect(listed.description).toContain('Second line stays in the blurb.');
    expect(listed.description).not.toBe('|');

    const before = fs.readFileSync(skillPath, 'utf8');
    const detail = getPiSkillDetail({ home, directory: project, name: 'brainstorming' });
    expect(detail.exists).toBe(true);
    expect(detail.sources.md.path).toBe(listed.path);
    expect(detail.sources.md.description).toContain('This skill brainstorms approaches.');
    expect(detail.sources.md.description).toContain('Second line stays in the blurb.');
    expect(detail.sources.md.description).not.toBe('|');
    expect(detail.sources.md.instructions).toBe('Ask clarifying questions first.');
    expect(fs.readFileSync(skillPath, 'utf8')).toBe(before);
    expect(fs.readFileSync(skillPath, 'utf8')).toBe(original);
  });

  it('loads a flat ~/.agents/skills/<name>/SKILL.md by name', () => {
    const home = makeTemp();
    const skillDir = path.join(home, '.agents', 'skills', 'find-skills');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: find-skills\ndescription: Helps users discover skills\n---\nSearch first.\n',
    );

    const detail = getPiSkillDetail({ home, name: 'find-skills' });
    expect(detail.exists).toBe(true);
    expect(detail.sources.md.description).toBe('Helps users discover skills');
    expect(detail.sources.md.instructions).toBe('Search first.');
    expect(detail.sources.md.path).toBe(path.join(skillDir, 'SKILL.md'));
  });

  it('dedupes the same skill path when the project directory is $HOME', () => {
    const home = makeTemp();
    fs.mkdirSync(path.join(home, '.agents', 'skills', 'review'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.agents', 'skills', 'review', 'SKILL.md'),
      '---\ndescription: Review code\n---\n',
    );

    const skills = listPiSkills({ home, directory: home });
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: 'review', scope: 'user' });

    const payload = toConfigSkillsPayload(skills, { home, directory: home });
    expect(payload.skills).toHaveLength(1);
    expect(payload.skills[0].injected).toBe(true);
  });

  it('keeps user and project skills that share a name when roots differ', () => {
    const home = makeTemp();
    const project = makeTemp();
    fs.mkdirSync(path.join(home, '.agents', 'skills', 'review'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.agents', 'skills', 'review', 'SKILL.md'),
      '---\ndescription: User review\n---\n',
    );
    fs.mkdirSync(path.join(project, '.agents', 'skills', 'review'), { recursive: true });
    fs.writeFileSync(
      path.join(project, '.agents', 'skills', 'review', 'SKILL.md'),
      '---\ndescription: Project review\n---\n',
    );

    const skills = listPiSkills({ home, directory: project });
    const reviews = skills.filter((skill) => skill.name === 'review');
    expect(reviews).toHaveLength(2);
    expect(reviews.map((skill) => skill.scope).sort()).toEqual(['project', 'user']);
    expect(reviews.find((skill) => skill.scope === 'user').description).toBe('User review');
    expect(reviews.find((skill) => skill.scope === 'project').description).toBe('Project review');

    const payload = toConfigSkillsPayload(skills, { home, directory: project });
    expect(payload.skills.find((skill) => skill.scope === 'user').injected).toBe(true);
    expect(payload.skills.find((skill) => skill.scope === 'project').injected).toBe(false);
  });

  it('reads and writes Pi defaults without touching auth.json', () => {
    const home = makeTemp();
    expect(readPiDefaults(home).thinking).toBe('medium');
    const saved = writePiDefaults(home, { model: 'example-provider/example-model', thinking: 'high', compaction: false });
    expect(saved).toMatchObject({
      model: 'example-provider/example-model',
      thinking: 'high',
      compaction: false,
      retry: true,
    });
    expect(readPiDefaults(home).model).toBe('example-provider/example-model');
    expect(fs.existsSync(path.join(home, '.pi', 'agent', 'auth.json'))).toBe(false);
  });

  it('writes and deletes user prompt commands under ~/.pi/agent/prompts', () => {
    const home = makeTemp();
    const created = writePiPrompt({
      home,
      name: 'ship',
      description: 'Prepare a change',
      template: 'Prepare the change for review.',
    });
    expect(created.path).toBe(path.join(home, '.pi', 'agent', 'prompts', 'ship.md'));
    expect(listPiCommands({ home }).some((command) => command.name === 'ship')).toBe(true);
    expect(() => writePiPrompt({ home, name: 'compact', template: 'nope' })).toThrow(/built-in/);
    expect(() => writePiPrompt({ home, name: 'model', template: 'nope' })).toThrow(/built-in/);
    expect(() => writePiPrompt({ home, name: 'thinking', template: 'nope' })).toThrow(/built-in/);
    const deleted = deletePiPrompt({ home, name: 'ship' });
    expect(deleted.deleted).toBe(true);
    expect(listPiCommands({ home }).some((command) => command.name === 'ship')).toBe(false);
  });

  it('reads Pi auth methods and sources without exposing keys', () => {
    const home = makeTemp();
    const agent = path.join(home, '.pi', 'agent');
    fs.mkdirSync(agent, { recursive: true });
    fs.writeFileSync(path.join(agent, 'auth.json'), JSON.stringify({
      'example-provider': { type: 'api', key: 'sk-test-do-not-leak' },
    }));
    fs.writeFileSync(path.join(agent, 'models.json'), JSON.stringify({
      providers: { 'example-provider': { baseUrl: 'https://example.test', apiKey: 'sk-test-do-not-leak' } },
    }));
    const methods = getPiAuthMethods(home);
    expect(methods['example-provider']).toEqual([{ type: 'api', label: 'API Key' }]);
    expect(JSON.stringify(methods)).not.toContain('sk-test');
    const sources = getPiProviderSources('example-provider', { home });
    expect(sources.sources.auth.exists).toBe(true);
    expect(sources.sources.user.exists).toBe(true);
    expect(sources.sources.auth.path).toContain(path.join('.pi', 'agent', 'auth.json'));
    const publicConfigs = listPiProviderPublicConfigs({ home });
    expect(publicConfigs['example-provider'].baseUrl).toBe('https://example.test');
    expect(JSON.stringify(publicConfigs)).not.toContain('sk-test');
  });

  it('writes Pi auth.json as api_key with 0600 and never returns the key', () => {
    const home = makeTemp();
    const saved = writePiProviderAuth('example-provider', { type: 'api', key: 'sk-test-do-not-leak' }, { home });
    expect(saved).toMatchObject({ providerId: 'example-provider', type: 'api' });
    expect(JSON.stringify(saved)).not.toContain('sk-test');

    const authPath = path.join(home, '.pi', 'agent', 'auth.json');
    const stored = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    expect(stored['example-provider']).toEqual({ type: 'api_key', key: 'sk-test-do-not-leak' });
    if (process.platform !== 'win32') {
      expect(fs.statSync(authPath).mode & 0o777).toBe(0o600);
    }
    expect(JSON.stringify(getPiAuthMethods(home))).not.toContain('sk-test');
    expect(() => writePiProviderAuth('session', { type: 'api', key: 'nope' }, { home })).toThrow(/reserved/);
    expect(() => writePiProviderAuth('example-provider', { type: 'api', key: '   ' }, { home })).toThrow(/API key/);
  });

  it('maps OpenCode custom provider payloads onto models.json without storing literal keys', () => {
    const home = makeTemp();
    writePiProviderAuth('acme', { type: 'api', key: 'sk-test-do-not-leak' }, { home });
    const upserted = upsertPiProviderConfig({
      home,
      providerId: 'acme',
      config: {
        npm: '@ai-sdk/openai-compatible',
        name: 'Acme',
        options: {
          baseURL: 'https://api.acme.test/v1',
          headers: { 'X-Custom-Header': 'from-settings' },
        },
        models: { 'grok-4.6': { name: 'Grok 4.6' } },
      },
    });
    expect(upserted.providerId).toBe('acme');
    expect(upserted.config.baseUrl).toBe('https://api.acme.test/v1');
    expect(upserted.config.api).toBe('openai-completions');
    expect(upserted.config.models).toEqual([{ id: 'grok-4.6', name: 'Grok 4.6' }]);
    expect(upserted.config.headers).toEqual({ 'X-Custom-Header': 'from-settings' });
    expect(upserted.config).not.toHaveProperty('apiKey');
    expect(JSON.stringify(upserted)).not.toContain('sk-test');

    const models = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'models.json'), 'utf8'));
    expect(models.providers.acme.apiKey).toBeUndefined();
    expect(models.providers.acme.npm).toBeUndefined();

    const envProvider = upsertPiProviderConfig({
      home,
      providerId: 'enved',
      config: {
        name: 'Env Provider',
        env: ['ACME_KEY'],
        options: { baseURL: 'https://env.acme.test/v1' },
        models: { fast: { name: 'Fast' } },
      },
    });
    expect(envProvider.config.baseUrl).toBe('https://env.acme.test/v1');
    const envModels = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'models.json'), 'utf8'));
    expect(envModels.providers.enved.apiKey).toBe('$ACME_KEY');
    expect(envProvider.config.env).toEqual(['ACME_KEY']);
    expect(envProvider.config).not.toHaveProperty('apiKey');
    expect(listPiProviderPublicConfigs({ home }).enved.env).toEqual(['ACME_KEY']);
    expect(JSON.stringify(listPiProviderPublicConfigs({ home }))).not.toContain('$ACME_KEY');

    expect(removePiProviderAuth('acme', { home })).toEqual({ providerId: 'acme', removed: true });
    expect(deletePiProviderConfig({ home, providerId: 'acme' }).removed).toBe(true);
    expect(getPiProviderSources('acme', { home }).sources.auth.exists).toBe(false);
    expect(getPiProviderSources('acme', { home }).sources.user.exists).toBe(false);

    expect(() => upsertPiProviderConfig({
      home,
      providerId: 'orphan',
      config: {
        name: 'Orphan',
        options: { baseURL: 'https://orphan.test/v1' },
        models: { x: { name: 'X' } },
      },
    })).toThrow(/API key or \{env:VAR\}/);
  });

  it('writes and removes provider auth in the Pi auth.json shape', () => {
    const home = makeTemp();
    const other = writePiProviderAuth('other-provider', { type: 'api', key: 'sk-keep-me' }, { home });
    expect(other).toMatchObject({
      providerId: 'other-provider',
      type: 'api',
      methods: [{ type: 'api', label: 'API Key' }],
    });
    const saved = writePiProviderAuth('example-provider', { type: 'api', key: 'sk-test-do-not-leak' }, { home });
    expect(saved.providerId).toBe('example-provider');
    expect(saved.methods).toEqual(getPiAuthMethods(home)['example-provider']);

    const authPath = path.join(home, '.pi', 'agent', 'auth.json');
    const stored = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    expect(stored['example-provider']).toEqual({ type: 'api_key', key: 'sk-test-do-not-leak' });
    expect(stored['other-provider']).toEqual({ type: 'api_key', key: 'sk-keep-me' });
    expect(getPiProviderSources('example-provider', { home }).sources.auth.exists).toBe(true);
    expect(JSON.stringify(getPiAuthMethods(home))).not.toContain('sk-test');

    writePiProviderAuth('example-provider', { auth: { type: 'api', key: 'sk-rotated' } }, { home });
    const rotated = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    expect(rotated['example-provider']).toEqual({ type: 'api_key', key: 'sk-rotated' });
    expect(rotated['other-provider'].key).toBe('sk-keep-me');

    const removed = removePiProviderAuth('example-provider', { home });
    expect(removed).toEqual({ providerId: 'example-provider', removed: true });
    const after = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    expect(after['example-provider']).toBeUndefined();
    expect(after['other-provider']).toEqual({ type: 'api_key', key: 'sk-keep-me' });
    expect(getPiProviderSources('example-provider', { home }).sources.auth.exists).toBe(false);
    expect(removePiProviderAuth('example-provider', { home }).removed).toBe(false);
  });

  it('rejects empty provider ids and missing API keys without creating auth.json', () => {
    const home = makeTemp();
    expect(() => writePiProviderAuth('', { type: 'api', key: 'sk-x' }, { home })).toThrow(/Provider ID/);
    expect(() => writePiProviderAuth('example-provider', { type: 'api', key: '   ' }, { home })).toThrow(/API key/);
    expect(fs.existsSync(path.join(home, '.pi', 'agent', 'auth.json'))).toBe(false);
  });

  it('refuses to overwrite a malformed auth.json', () => {
    const home = makeTemp();
    const agent = path.join(home, '.pi', 'agent');
    fs.mkdirSync(agent, { recursive: true });
    fs.writeFileSync(path.join(agent, 'auth.json'), '{not-json');
    expect(() => writePiProviderAuth('example-provider', { type: 'api', key: 'sk-x' }, { home })).toThrow(/auth\.json/);
    expect(fs.readFileSync(path.join(agent, 'auth.json'), 'utf8')).toBe('{not-json');
  });

  it('persists compaction and retry objects without wiping other agent settings', () => {
    const home = makeTemp();
    const agentDir = path.join(home, '.pi', 'agent');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'settings.json'), JSON.stringify({ theme: 'keep-me', compaction: { enabled: true } }) + '\n');
    const saved = writePiDefaults(home, {
      compaction: true,
      compactionSettings: { reserveTokens: 4096, keepRecentTokens: 8000 },
      retrySettings: { maxRetries: 5, baseDelayMs: 1500 },
    });
    expect(saved.compaction).toBe(true);
    expect(saved.compactionSettings).toMatchObject({ enabled: true, reserveTokens: 4096, keepRecentTokens: 8000 });
    expect(saved.retrySettings).toMatchObject({ enabled: true, maxRetries: 5, baseDelayMs: 1500 });
    const again = readPiDefaults(home);
    expect(again.compactionSettings.reserveTokens).toBe(4096);
    expect(again.retrySettings.maxRetries).toBe(5);
    const chamber = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'pichamber.json'), 'utf8'));
    expect(chamber.compaction).toBe(true);
    expect(chamber.retry).toBe(true);
    expect(chamber.compactionSettings).toBeUndefined();
    const agent = JSON.parse(fs.readFileSync(path.join(agentDir, 'settings.json'), 'utf8'));
    expect(agent.theme).toBe('keep-me');
    expect(agent.compaction.reserveTokens).toBe(4096);
    expect(agent.retry.maxRetries).toBe(5);
  });

  it('lists user and project extensions and installed packages', () => {
    const home = makeTemp();
    const project = makeTemp();
    const pkgSource = 'n' + 'pm';
    fs.mkdirSync(path.join(home, '.pi', 'agent', 'extensions', 'demo-ext'), { recursive: true });
    fs.writeFileSync(path.join(home, '.pi', 'agent', 'extensions', 'demo-ext', 'index.js'), 'export default {};\n');
    fs.mkdirSync(path.join(project, '.pi', 'extensions'), { recursive: true });
    fs.writeFileSync(path.join(project, '.pi', 'extensions', 'local.js'), 'export default {};\n');
    const userPkg = path.join(home, '.pi', 'agent', pkgSource, 'demo-pkg');
    fs.mkdirSync(userPkg, { recursive: true });
    fs.writeFileSync(path.join(userPkg, 'package.json'), JSON.stringify({ name: 'demo-pkg', version: '1.0.0' }));
    const extensions = listPiExtensions({ home, directory: project });
    expect(extensions.map((item) => item.name).sort()).toEqual(['demo-ext', 'local']);
    expect(extensions.find((item) => item.name === 'demo-ext').scope).toBe('user');
    expect(extensions.find((item) => item.name === 'local').scope).toBe('project');
    const packages = listPiPackages({ home, directory: project });
    expect(packages.some((item) => item.name === 'demo-pkg' && item.source === pkgSource && item.scope === 'user')).toBe(true);
  });

  it('reads and writes project trust in a temp home', () => {
    const home = makeTemp();
    const project = path.join(home, 'code', 'demo');
    const initial = readPiProjectTrust(home, project);
    expect(initial.defaultProjectTrust).toBe('ask');
    expect(initial.decisions).toEqual([]);
    expect(initial.current).toEqual({ path: path.resolve(project), trusted: null });

    const saved = writePiProjectTrust(home, {
      defaultProjectTrust: 'always',
      decisions: [{ path: project, trusted: true }],
    }, project);
    expect(saved.defaultProjectTrust).toBe('always');
    expect(saved.current.trusted).toBe(true);
    expect(saved.decisions).toEqual([{ path: path.resolve(project), trusted: true }]);

    const untrusted = setPiProjectTrust(home, project, false);
    expect(untrusted.trusted).toBe(false);
    const again = readPiProjectTrust(home, project);
    expect(again.defaultProjectTrust).toBe('always');
    expect(again.current.trusted).toBe(false);
    const raw = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'trust.json'), 'utf8'));
    expect(raw[path.resolve(project)]).toBe(false);
    const settings = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'settings.json'), 'utf8'));
    expect(settings.defaultProjectTrust).toBe('always');
  });

  it('persists enabledModels and filters the runtime catalog', () => {
    const home = makeTemp();
    expect(readPiDefaults(home).enabledModels).toEqual([]);
    const saved = writePiDefaults(home, {
      enabledModels: ['example-provider/alpha', 'example-provider/alpha', ' other/beta '],
    });
    expect(saved.enabledModels).toEqual(['example-provider/alpha', 'other/beta']);
    expect(readPiDefaults(home).enabledModels).toEqual(['example-provider/alpha', 'other/beta']);
    const agent = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'settings.json'), 'utf8'));
    expect(agent.enabledModels).toEqual(['example-provider/alpha', 'other/beta']);

    const catalog = [
      {
        id: 'example-provider',
        models: { alpha: { id: 'alpha', name: 'Alpha' }, gamma: { id: 'gamma', name: 'Gamma' } },
      },
      {
        id: 'other',
        models: { beta: { id: 'beta', name: 'Beta' } },
      },
    ];
    const filtered = filterProvidersByEnabledModels(catalog, saved.enabledModels);
    expect(filtered.map((item) => item.id)).toEqual(['example-provider', 'other']);
    expect(Object.keys(filtered[0].models)).toEqual(['alpha']);
    expect(filterProvidersByEnabledModels(catalog, []).map((item) => item.id)).toEqual(['example-provider', 'other']);

    const cleared = writePiDefaults(home, { enabledModels: [] });
    expect(cleared.enabledModels).toEqual([]);
    const after = JSON.parse(fs.readFileSync(path.join(home, '.pi', 'agent', 'settings.json'), 'utf8'));
    expect(after.enabledModels).toBeUndefined();
  });

  it('marks untrusted project skills as not injected', () => {
    const home = makeTemp();
    const project = makeTemp();
    fs.mkdirSync(path.join(home, '.pi', 'agent', 'skills', 'review'), { recursive: true });
    fs.writeFileSync(path.join(home, '.pi', 'agent', 'skills', 'review', 'SKILL.md'), '---\ndescription: Review\n---\n');
    fs.mkdirSync(path.join(project, '.pi', 'skills', 'local'), { recursive: true });
    fs.writeFileSync(path.join(project, '.pi', 'skills', 'local', 'SKILL.md'), '---\ndescription: Local\n---\n');

    const skills = listPiSkills({ home, directory: project });
    const untrusted = toConfigSkillsPayload(skills, { home, directory: project });
    expect(untrusted.projectTrust.trusted).toBe(false);
    expect(untrusted.skills.find((skill) => skill.name === 'review').injected).toBe(true);
    expect(untrusted.skills.find((skill) => skill.name === 'local').injected).toBe(false);

    setPiProjectTrust(home, project, true);
    const trusted = toConfigSkillsPayload(skills, { home, directory: project });
    expect(trusted.projectTrust.trusted).toBe(true);
    expect(trusted.skills.find((skill) => skill.name === 'local').injected).toBe(true);
  });
});

describe('behavior AGENTS.md', () => {
  const withUnsetDataDir = (fn) => {
    const previous = process.env.OPENCHAMBER_DATA_DIR;
    delete process.env.OPENCHAMBER_DATA_DIR;
    try {
      return fn();
    } finally {
      if (previous === undefined) delete process.env.OPENCHAMBER_DATA_DIR;
      else process.env.OPENCHAMBER_DATA_DIR = previous;
    }
  };

  it('reads and writes only ~/.pi/agent/AGENTS.md as the global user prompt', () => {
    const home = makeTemp();
    const userPath = resolvePiAgentsMdPath(home);
    expect(resolveBehaviorAgentsMd(home)).toEqual({
      path: userPath,
      scope: 'user',
      exists: false,
    });
    expect(readBehaviorAgentsMd(home)).toMatchObject({
      path: userPath,
      scope: 'user',
      exists: false,
      content: '',
    });

    fs.mkdirSync(path.dirname(userPath), { recursive: true });
    fs.writeFileSync(userPath, 'Be concise.\n');
    expect(resolveBehaviorAgentsMd(home)).toEqual({
      path: userPath,
      scope: 'user',
      exists: true,
    });
    expect(readBehaviorAgentsMd(home).content).toBe('Be concise.\n');
  });

  it('does not present project/repo AGENTS.md as the global user prompt', () => {
    withUnsetDataDir(() => {
      const home = makeTemp();
      const project = makeTemp();
      fs.mkdirSync(path.join(home, '.config', 'openchamber'), { recursive: true });
      fs.writeFileSync(
        path.join(home, '.config', 'openchamber', 'settings.json'),
        JSON.stringify({ lastDirectory: project }),
      );
      fs.writeFileSync(path.join(project, 'AGENTS.md'), '# Pichamber Agent Guide\nRepo rules only.\n');

      const resolved = resolveBehaviorAgentsMd(home);
      expect(resolved.scope).toBe('user');
      expect(resolved.exists).toBe(false);
      expect(resolved.path).toBe(path.join(home, '.pi', 'agent', 'AGENTS.md'));
      expect(resolved.path).not.toBe(path.join(project, 'AGENTS.md'));

      const read = readBehaviorAgentsMd(home);
      expect(read.content).toBe('');
      expect(read.exists).toBe(false);
      expect(read.scope).toBe('user');

      const projectResolved = resolveProjectAgentsMd(home);
      expect(projectResolved).toEqual({
        path: path.join(project, 'AGENTS.md'),
        scope: 'project',
        exists: true,
      });
    });
  });

  it('keeps a user AGENTS.md even when a project file also exists', () => {
    withUnsetDataDir(() => {
      const home = makeTemp();
      const project = makeTemp();
      const userPath = resolvePiAgentsMdPath(home);
      fs.mkdirSync(path.dirname(userPath), { recursive: true });
      fs.writeFileSync(userPath, 'User global rules.\n');
      fs.mkdirSync(path.join(home, '.config', 'openchamber'), { recursive: true });
      fs.writeFileSync(
        path.join(home, '.config', 'openchamber', 'settings.json'),
        JSON.stringify({ lastDirectory: project }),
      );
      fs.writeFileSync(path.join(project, 'AGENTS.md'), '# Pichamber Agent Guide\n');

      const read = readBehaviorAgentsMd(home);
      expect(read).toMatchObject({
        path: userPath,
        scope: 'user',
        exists: true,
        content: 'User global rules.\n',
      });
      expect(resolveProjectAgentsMd(home).exists).toBe(true);
    });
  });
});

describe('resolvePiDefaultModel', () => {
  const catalog = [
    { id: 'bmlab', models: { 'grok-4.6': { id: 'grok-4.6', name: 'Grok 4.6' } } },
    { id: 'other', models: { beta: { id: 'beta', name: 'Beta' } } },
  ];

  it('uses the first catalog model when the stored default is empty', () => {
    expect(resolvePiDefaultModel('', catalog)).toBe('bmlab/grok-4.6');
    expect(resolvePiDefaultModel('   ', catalog)).toBe('bmlab/grok-4.6');
  });

  it('keeps a pinned model that is still in the catalog', () => {
    expect(resolvePiDefaultModel('other/beta', catalog)).toBe('other/beta');
  });

  it('falls back to the first catalog model when the pin is gone', () => {
    expect(resolvePiDefaultModel('missing/gone', catalog)).toBe('bmlab/grok-4.6');
  });
});

