import { describe, expect, test } from 'bun:test';

import {
  applySharedProjectSetupPatch,
  DEFAULT_PLANS_DIR,
  isSharedProjectConfigEmpty,
  mergeProjectSetup,
  normalizePlansDir,
  parseSharedProjectConfig,
  personalSetupOf,
  resolvePlansDirRelative,
  serializeSharedProjectConfig,
  sharedTrustHashOf,
  SHARED_CONFIG_RELATIVE_PATH,
  EMPTY_SHARED_PROJECT_CONFIG,
} from './sharedProjectConfig';
import {
  resolveProjectPlansDirectory,
  resolveProjectPlansDirectoryFromShared,
} from './projectPlansPath';

describe('normalizePlansDir', () => {
  test('accepts a relative path inside the repo only', () => {
    expect(normalizePlansDir('docs/plans')).toBe('docs/plans');
    expect(normalizePlansDir('./docs/plans/')).toBe('docs/plans');
    expect(normalizePlansDir('/etc')).toBeNull();
    expect(normalizePlansDir('../x')).toBeNull();
  });
});

describe('parseSharedProjectConfig', () => {
  test('parses plansDir and actions', () => {
    const raw = JSON.stringify({
      version: 1,
      plansDir: 'docs/plans',
      setupWorktree: ['bun install'],
      projectActions: [{ id: 'dev', name: 'Dev', command: 'bun run dev' }],
    });
    const parsed = parseSharedProjectConfig(raw);
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(parsed.config.plansDir).toBe('docs/plans');
    expect(parsed.config.setupWorktree).toEqual(['bun install']);
    expect(parsed.config.projectActions[0]?.id).toBe('dev');
  });
});

describe('mergeProjectSetup + trust hash', () => {
  test('merges shared then personal; trust requires matching hash', () => {
    const personal = personalSetupOf({
      'setup-worktree': ['echo personal'],
      projectActions: [{ id: 'local', name: 'Local', command: 'echo local' }],
    });
    const shared = parseSharedProjectConfig(JSON.stringify({
      version: 1,
      setupWorktree: ['bun install'],
      projectActions: [{ id: 'dev', name: 'Dev', command: 'bun run dev' }],
    }));
    const hash = sharedTrustHashOf(shared.status === 'ok' ? shared.config : EMPTY_SHARED_PROJECT_CONFIG);
    expect(hash).toBeTruthy();
    const untrusted = mergeProjectSetup(personal, shared, hash);
    expect(untrusted.trust.trusted).toBe(false);
    expect(untrusted.setupWorktree).toEqual(['bun install', 'echo personal']);
    expect(untrusted.projectActions.map((a) => a.id)).toEqual(['dev', 'local']);
    expect(untrusted.projectActions[0]?.source).toBe('shared');

    const trustedPersonal = personalSetupOf({
      'setup-worktree': ['echo personal'],
      projectActions: [{ id: 'local', name: 'Local', command: 'echo local' }],
      sharedTrust: { hash: hash!, trustedAt: 1 },
    });
    expect(mergeProjectSetup(trustedPersonal, shared, hash).trust.trusted).toBe(true);
  });
});

describe('applySharedProjectSetupPatch / serialize', () => {
  test('sets and clears plansDir', () => {
    const next = applySharedProjectSetupPatch(EMPTY_SHARED_PROJECT_CONFIG, { plansDir: './docs/plans/' });
    expect(next.plansDir).toBe('docs/plans');
    expect(isSharedProjectConfigEmpty(next)).toBe(false);
    expect(serializeSharedProjectConfig(next)).toContain('"plansDir": "docs/plans"');
  });
});

describe('resolveProjectPlansDirectory', () => {
  test('defaults and honors shared plansDir', () => {
    expect(DEFAULT_PLANS_DIR).toBe('.pichamber/plans');
    expect(resolveProjectPlansDirectory({ id: 'p', path: '/repo' })).toBe('/repo/.pichamber/plans');
    const shared = parseSharedProjectConfig('{"version":1,"plansDir":"docs/plans"}');
    expect(resolvePlansDirRelative(shared)).toBe('docs/plans');
    expect(resolveProjectPlansDirectoryFromShared({ id: 'p', path: '/repo' }, shared)).toBe('/repo/docs/plans');
    expect(SHARED_CONFIG_RELATIVE_PATH).toBe('.pichamber/project.json');
  });
});
