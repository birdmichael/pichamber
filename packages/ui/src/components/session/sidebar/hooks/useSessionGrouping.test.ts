import { describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';
import { nestSessionsByParentID } from './useSessionGrouping';

const session = (
  id: string,
  extra: Partial<Session> & { parentID?: string | null } = {},
): Session & { parentID?: string | null } => ({
  id,
  title: extra.title ?? id,
  time: extra.time ?? { created: 1, updated: 1 },
  ...extra,
} as Session & { parentID?: string | null });

describe('nestSessionsByParentID', () => {
  test('nests a matching parentID child under the only root', () => {
    const parent = session('parent');
    const child = session('child', { parentID: 'parent' });

    const { roots, childrenByParent } = nestSessionsByParentID([parent, child]);

    expect(roots.map((item) => item.id)).toEqual(['parent']);
    expect(childrenByParent.get('parent')?.map((item) => item.id)).toEqual(['child']);
  });

  test('keeps an orphan child as a root when the parent is missing', () => {
    const orphan = session('orphan', { parentID: 'missing-parent' });

    const { roots, childrenByParent } = nestSessionsByParentID([orphan]);

    expect(roots.map((item) => item.id)).toEqual(['orphan']);
    expect(childrenByParent.size).toBe(0);
  });

  test('does not nest when archive state does not match', () => {
    const parent = session('parent');
    const archivedChild = session('child', {
      parentID: 'parent',
      time: { created: 1, updated: 2, archived: 9 },
    });

    const { roots, childrenByParent } = nestSessionsByParentID([parent, archivedChild]);

    expect(roots.map((item) => item.id)).toEqual(['parent', 'child']);
    expect(childrenByParent.size).toBe(0);
  });
});

describe('worktree-cwd children with a valid parentID', () => {
  test('stay nested under the parent even when directories differ', () => {
    const parent = session('parent', { directory: '/repo' } as Partial<Session>);
    const child = session('child', { parentID: 'parent', directory: '/repo-worktree' } as Partial<Session> & { parentID?: string | null });

    const { roots, childrenByParent } = nestSessionsByParentID([parent, child]);

    expect(roots.map((item) => item.id)).toEqual(['parent']);
    expect(childrenByParent.get('parent')?.map((item) => item.id)).toEqual(['child']);
  });
});
