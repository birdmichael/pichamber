import { describe, expect, test } from 'bun:test';
import { resolveEffectiveSingleProjectId } from './projectDisplay';

describe('resolveEffectiveSingleProjectId', () => {
  test('returns null when the sidebar is showing every project', () => {
    expect(resolveEffectiveSingleProjectId(false, 'alpha', 'beta', ['alpha', 'beta'])).toBeNull();
  });

  test('prefers the persisted single project when it is still present', () => {
    expect(resolveEffectiveSingleProjectId(true, 'alpha', 'beta', ['alpha', 'beta'])).toBe('alpha');
  });

  test('falls back to the active project when the persisted id is gone', () => {
    expect(resolveEffectiveSingleProjectId(true, 'gone', 'beta', ['alpha', 'beta'])).toBe('beta');
  });

  test('falls back to the first project when neither stored id is present', () => {
    expect(resolveEffectiveSingleProjectId(true, 'gone', 'also-gone', ['alpha', 'beta'])).toBe('alpha');
  });

  test('returns null when there are no projects to focus', () => {
    expect(resolveEffectiveSingleProjectId(true, 'alpha', 'beta', [])).toBeNull();
  });
});
