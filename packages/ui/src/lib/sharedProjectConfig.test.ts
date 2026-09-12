import { describe, expect, test } from 'bun:test';

import {
  applySharedProjectSetupPatch,
  DEFAULT_PLANS_DIR,
  isSharedProjectConfigEmpty,
  normalizePlansDir,
  parseSharedProjectConfig,
  resolvePlansDirRelative,
  serializeSharedProjectConfig,
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
    expect(normalizePlansDir('C:\\plans')).toBeNull();
    expect(normalizePlansDir('')).toBeNull();
  });
});

describe('parseSharedProjectConfig', () => {
  test('parses plansDir and rejects paths outside the repo', () => {
    expect(parseSharedProjectConfig('{"version":1,"plansDir":"docs/plans"}')).toEqual({
      status: 'ok',
      path: SHARED_CONFIG_RELATIVE_PATH,
      config: {
        setupWorktree: [],
        setupWorktreeWait: null,
        projectActions: [],
        draftStarters: [],
        plansDir: 'docs/plans',
      },
    });
    expect(parseSharedProjectConfig('{"version":1}')).toEqual({
      status: 'ok',
      path: SHARED_CONFIG_RELATIVE_PATH,
      config: { ...EMPTY_SHARED_PROJECT_CONFIG },
    });
    expect(parseSharedProjectConfig('{"version":1,"plansDir":"/etc"}').status).toBe('invalid');
    expect(parseSharedProjectConfig('not-json').status).toBe('invalid');
  });
});

describe('applySharedProjectSetupPatch / serialize', () => {
  test('sets and clears plansDir; empty configs serialize to version only', () => {
    const next = applySharedProjectSetupPatch(EMPTY_SHARED_PROJECT_CONFIG, { plansDir: './docs/plans/' });
    expect(next.plansDir).toBe('docs/plans');
    expect(isSharedProjectConfigEmpty(next)).toBe(false);
    expect(serializeSharedProjectConfig(next)).toBe([
      '{',
      '  "version": 1,',
      '  "plansDir": "docs/plans"',
      '}',
      '',
    ].join('\n'));
    expect(applySharedProjectSetupPatch(next, { plansDir: '' }).plansDir).toBeNull();
    expect(() => applySharedProjectSetupPatch(EMPTY_SHARED_PROJECT_CONFIG, { plansDir: '/etc' })).toThrow(
      'plansDir must be',
    );
  });
});

describe('resolveProjectPlansDirectory', () => {
  test('defaults to .pichamber/plans in the real project', () => {
    expect(resolveProjectPlansDirectory({ id: 'proj', path: '/Users/me/code/app' })).toBe(
      '/Users/me/code/app/.pichamber/plans',
    );
    expect(DEFAULT_PLANS_DIR).toBe('.pichamber/plans');
    expect(resolveProjectPlansDirectory({ id: 'proj', path: '/Users/me/code/app' })).not.toContain(
      '.config/pichamber/projects',
    );
  });

  test('honors shared plansDir pointer', () => {
    const shared = parseSharedProjectConfig('{"version":1,"plansDir":"docs/plans"}');
    expect(resolvePlansDirRelative(shared)).toBe('docs/plans');
    expect(resolveProjectPlansDirectoryFromShared({ id: 'proj', path: '/repo' }, shared)).toBe(
      '/repo/docs/plans',
    );
    expect(resolveProjectPlansDirectoryFromShared({ id: 'proj', path: '/repo' }, { status: 'missing', path: SHARED_CONFIG_RELATIVE_PATH })).toBe(
      '/repo/.pichamber/plans',
    );
  });

  test('rejects an empty project path', () => {
    expect(resolveProjectPlansDirectory({ id: 'proj', path: '   ' })).toBeNull();
  });
});
