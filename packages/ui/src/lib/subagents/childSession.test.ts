import { describe, expect, test } from 'bun:test';

import { canOpenSubagentChildSession, openSubagentChildSession } from './childSession';

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
