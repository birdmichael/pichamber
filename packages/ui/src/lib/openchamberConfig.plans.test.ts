import { describe, expect, test } from 'bun:test';

import { resolveProjectPlansDirectory } from './projectPlansPath';

describe('resolveProjectPlansDirectory', () => {
  test('writes plans into the real project, not app config', () => {
    expect(resolveProjectPlansDirectory({ id: 'proj', path: '/Users/me/code/app' })).toBe(
      '/Users/me/code/app/.pichamber/plans',
    );
    expect(resolveProjectPlansDirectory({ id: 'proj', path: '/Users/me/code/app' })).not.toContain(
      '.config/openchamber/projects',
    );
  });

  test('rejects an empty project path', () => {
    expect(resolveProjectPlansDirectory({ id: 'proj', path: '   ' })).toBeNull();
  });
});
