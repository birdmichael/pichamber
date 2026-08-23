import { describe, expect, test } from 'bun:test';
import {
  isOpenedProjectPath,
  normalizeOpenedProjectPaths,
  shouldRenderSidebarWorktreeGroup,
} from './visibleWorkspaceGroups';

describe('visible workspace groups', () => {
  const opened = normalizeOpenedProjectPaths(['/home/box/', '/workspace/pichamber']);

  test('treats Settings projects as opened, including home', () => {
    expect(opened).toEqual(new Set(['/home/box', '/workspace/pichamber']));
    expect(isOpenedProjectPath('/home/box', opened)).toBe(true);
    expect(isOpenedProjectPath('/home/box/', opened)).toBe(true);
    expect(isOpenedProjectPath('/workspace/pichamber', opened)).toBe(true);
    expect(isOpenedProjectPath('/tmp/cursor/desktop-create-pr-e123', opened)).toBe(false);
    expect(isOpenedProjectPath(null, opened)).toBe(false);
  });

  test('keeps a worktree group that has sessions even when it is not a project', () => {
    expect(shouldRenderSidebarWorktreeGroup({
      directory: '/worktrees/cursor/desktop-create-pr-e123',
      sessionCount: 2,
      openedProjectPaths: opened,
    })).toBe(true);
  });

  test('hides empty leftover worktree groups that are not opened projects', () => {
    expect(shouldRenderSidebarWorktreeGroup({
      directory: '/worktrees/cursor/desktop-create-pr-e123',
      sessionCount: 0,
      openedProjectPaths: opened,
    })).toBe(false);
    expect(shouldRenderSidebarWorktreeGroup({
      directory: '/tmp/cursor/desktop-plan-side-p456',
      sessionCount: 0,
      openedProjectPaths: opened,
    })).toBe(false);
  });

  test('keeps an empty worktree group when that path is itself an opened project', () => {
    expect(shouldRenderSidebarWorktreeGroup({
      directory: '/home/box',
      sessionCount: 0,
      openedProjectPaths: opened,
    })).toBe(true);
  });
});
