import { describe, expect, test } from 'bun:test';

import { resolveProjectPlansDirectory } from './projectPlansPath';
import { DEFAULT_PLANS_DIR } from './sharedProjectConfig';

describe('resolveProjectPlansDirectory (default)', () => {
  test('writes plans into the real project .pichamber/plans, not app config', () => {
    expect(DEFAULT_PLANS_DIR).toBe('.pichamber/plans');
    expect(resolveProjectPlansDirectory({ id: 'proj', path: '/Users/me/code/app' })).toBe(
      '/Users/me/code/app/.pichamber/plans',
    );
    expect(resolveProjectPlansDirectory({ id: 'proj', path: '/Users/me/code/app' })).not.toContain(
      '.config/pichamber/projects',
    );
    expect(resolveProjectPlansDirectory({ id: 'proj', path: '/Users/me/code/app' })).not.toContain(
      '.config/openchamber/projects',
    );
  });

  test('rejects an empty project path', () => {
    expect(resolveProjectPlansDirectory({ id: 'proj', path: '   ' })).toBeNull();
  });
});
