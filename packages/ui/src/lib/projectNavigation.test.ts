import { describe, expect, test } from 'bun:test';
import { pickAdjacentProject, resolveVisibleProjectId } from './projectNavigation';

const projects = [
  { id: 'sess-fx', path: '/Users/bm/sess-fx' },
  { id: 'other', path: '/Users/bm/other' },
];

describe('resolveVisibleProjectId', () => {
  test('treats a managed chats directory as projectless even when a project is inherited', () => {
    expect(resolveVisibleProjectId({
      projects,
      currentDirectory: '/Users/bm/.config/openchamber/chats/token-tip',
      homeDirectory: '/Users/bm',
    })).toBe(null);
  });

  test('matches the project whose path is the current directory', () => {
    expect(resolveVisibleProjectId({
      projects,
      currentDirectory: '/Users/bm/sess-fx',
      homeDirectory: '/Users/bm',
    })).toBe('sess-fx');
  });
});

describe('pickAdjacentProject', () => {
  test('from a projectless chat, Next Project is the first workspace', () => {
    expect(pickAdjacentProject(projects, null, 1)?.id).toBe('sess-fx');
    expect(pickAdjacentProject(projects, null, -1)?.id).toBe('other');
  });

  test('wraps among workspace projects', () => {
    expect(pickAdjacentProject(projects, 'sess-fx', 1)?.id).toBe('other');
    expect(pickAdjacentProject(projects, 'other', 1)?.id).toBe('sess-fx');
  });
});
