import { describe, expect, test } from 'bun:test';
import { planDirectoryHistoryChrome } from './directoryHistoryChrome';

const projects = [
  { id: 'scan-proj', path: '/tmp/pichamber-scan-proj' },
  { id: 'pichamber', path: '/workspace/pichamber' },
  { id: 'box', path: '/home/box' },
];

describe('planDirectoryHistoryChrome', () => {
  test('restores the project matched by the rewound directory and its first session', () => {
    expect(planDirectoryHistoryChrome({
      projects,
      currentDirectory: '/workspace/pichamber',
      homeDirectory: '/home/box',
      sessions: [{ id: 'ses_pichamber_latest' }, { id: 'ses_older' }],
    })).toEqual({
      kind: 'restore-project',
      projectId: 'pichamber',
      projectPath: '/workspace/pichamber',
      sessionId: 'ses_pichamber_latest',
    });
  });

  test('opens a project draft when the matched directory has no sessions yet', () => {
    expect(planDirectoryHistoryChrome({
      projects,
      currentDirectory: '/tmp/pichamber-scan-proj',
      homeDirectory: '/home/box',
      sessions: [],
    })).toEqual({
      kind: 'restore-project',
      projectId: 'scan-proj',
      projectPath: '/tmp/pichamber-scan-proj',
      sessionId: null,
    });
  });

  test('is a no-op for managed chat directories that are not workspace projects', () => {
    expect(planDirectoryHistoryChrome({
      projects,
      currentDirectory: '/Users/bm/.config/openchamber/chats/token-tip',
      homeDirectory: '/Users/bm',
      sessions: [{ id: 'ses_chat' }],
    })).toEqual({ kind: 'noop' });
  });

  test('is a no-op when the directory matches no opened project', () => {
    expect(planDirectoryHistoryChrome({
      projects,
      currentDirectory: '/tmp/unrelated',
      homeDirectory: '/home/box',
      sessions: [{ id: 'ses_x' }],
    })).toEqual({ kind: 'noop' });
  });
});
