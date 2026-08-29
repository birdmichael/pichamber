import { describe, expect, test } from 'bun:test';

import {
  canOpenSubagentChildSession,
  contextChatScopeKey,
  openSubagentChildSession,
  resolveParentDirectoryForChildIdle,
  resolveSubagentChildDirectory,
} from './childSession';

describe('contextChatScopeKey', () => {
  test('keys the panel to the parent session', () => {
    expect(contextChatScopeKey('ses_parent')).toBe('session:ses_parent');
    expect(contextChatScopeKey('  ses_parent  ')).toBe('session:ses_parent');
    expect(contextChatScopeKey('')).toBe('');
    expect(contextChatScopeKey(null)).toBe('');
  });
});

describe('canOpenSubagentChildSession', () => {
  test('requires both a session id and a directory', () => {
    expect(canOpenSubagentChildSession('ses_child', '/repo')).toBe(true);
    expect(canOpenSubagentChildSession('', '/repo')).toBe(false);
    expect(canOpenSubagentChildSession('ses_child', '')).toBe(false);
    expect(canOpenSubagentChildSession(null, '/repo')).toBe(false);
  });
});

describe('openSubagentChildSession', () => {
  test('opens a writable context-panel tab and does not post as the parent', () => {
    const opened: Array<Record<string, unknown>> = [];
    const setCurrentSession = () => {
      throw new Error('must not navigate the parent surface');
    };
    const openedOk = openSubagentChildSession({
      sessionID: 'ses_child',
      parentSessionID: 'ses_parent',
      directory: '/repo',
      label: 'scout',
      readOnly: false,
      isMobile: false,
      isVSCode: false,
      isEmbedded: false,
      setCurrentSession,
      openContextPanelTab: (directory, options) => {
        opened.push({ directory, ...options });
      },
    });
    expect(openedOk).toBe(true);
    expect(opened).toEqual([{
      directory: '/repo',
      mode: 'chat',
      dedupeKey: 'session:ses_child',
      label: 'scout',
      readOnly: false,
      sessionScope: 'session:ses_parent',
    }]);
  });

  test('navigates in place on mobile, embedded, and VS Code', () => {
    const navigated: Array<[string, string]> = [];
    const openContextPanelTab = () => {
      throw new Error('must not open a side panel');
    };
    expect(openSubagentChildSession({
      sessionID: 'ses_child',
      directory: '/repo',
      label: 'reviewer',
      readOnly: false,
      isMobile: true,
      isVSCode: false,
      isEmbedded: false,
      setCurrentSession: (sessionID, directory) => navigated.push([sessionID, directory]),
      openContextPanelTab,
    })).toBe(true);
    expect(navigated).toEqual([['ses_child', '/repo']]);
  });

  test('does not open a tab when the run has no session id', () => {
    let opened = 0;
    expect(openSubagentChildSession({
      sessionID: null,
      directory: '/repo',
      label: 'scout',
      readOnly: false,
      isMobile: false,
      isVSCode: false,
      isEmbedded: false,
      setCurrentSession: () => {
        opened += 1;
      },
      openContextPanelTab: () => {
        opened += 1;
      },
    })).toBe(false);
    expect(opened).toBe(0);
  });
});

describe('resolveSubagentChildDirectory', () => {
  test('prefers the child directory and falls back to the parent only when missing', () => {
    expect(resolveSubagentChildDirectory({ directory: '/repo-worktree' }, '/repo')).toBe('/repo-worktree');
    expect(resolveSubagentChildDirectory('/repo-worktree', '/repo')).toBe('/repo-worktree');
    expect(resolveSubagentChildDirectory({ directory: null }, '/repo')).toBe('/repo');
    expect(resolveSubagentChildDirectory(null, null)).toBeNull();
  });
});

describe('resolveParentDirectoryForChildIdle', () => {
  test('rematerializes the parent using the parent directory, not the child cwd', () => {
    expect(resolveParentDirectoryForChildIdle({ directory: '/repo' })).toBe('/repo');
    expect(resolveParentDirectoryForChildIdle({ directory: null })).toBeNull();
    expect(resolveParentDirectoryForChildIdle(undefined)).toBeNull();
  });
});
