import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  listPiCommands,
  listPiSkills,
  parseMarkdownFrontmatter,
  readPiDefaults,
  writePiDefaults,
  writePiPrompt,
  deletePiPrompt,
  getPiAuthMethods,
  getPiProviderSources,
  writePiProviderAuth,
  removePiProviderAuth,
  listPiExtensions,
  listPiPackages,
  filterProvidersByEnabledModels,
  resolvePiDefaultModel,
  readPiProjectTrust,
  writePiProjectTrust,
  setPiProjectTrust,
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

    const skills = listPiSkills({ home, directory: project });
    expect(skills.map((skill) => skill.name).sort()).toEqual(['local', 'review']);
    expect(skills.find((skill) => skill.name === 'review').scope).toBe('user');
    expect(skills.find((skill) => skill.name === 'local').scope).toBe('project');

    const commands = listPiCommands({ home, directory: project });
    expect(commands.some((command) => command.name === 'compact' && command.source === 'builtin')).toBe(true);
    expect(commands.some((command) => command.name === 'ship' && command.template.includes('Prepare the change'))).toBe(true);
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
      providers: { 'example-provider': { baseUrl: 'https://example.test' } },
    }));
    const methods = getPiAuthMethods(home);
    expect(methods['example-provider']).toEqual([{ type: 'api', label: 'API Key' }]);
    expect(JSON.stringify(methods)).not.toContain('sk-test');
    const sources = getPiProviderSources('example-provider', { home });
    expect(sources.sources.auth.exists).toBe(true);
    expect(sources.sources.user.exists).toBe(true);
    expect(sources.sources.auth.path).toContain(path.join('.pi', 'agent', 'auth.json'));
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
