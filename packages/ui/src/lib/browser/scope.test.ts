import { describe, expect, test } from 'bun:test';

import { CHAT_DRAFT_PROJECT_ID } from '@/lib/chatDirectories';
import {
  isBrowserTabIdentity,
  mergeContextPanelChatScope,
  mergeContextPanelForBrowserScope,
  openedProjectPathSet,
  resolveBrowserScopeKey,
} from './scope';

const HOME = '/Users/tester';
const CHAT_A = '/Users/tester/.config/openchamber/chats/2026-08-25/session-a';
const CHAT_B = '/Users/tester/.config/openchamber/chats/2026-08-25/session-b';
const PROJECT_A = '/Users/tester/project-a';
const PROJECT_B = '/Users/tester/project-b';

describe('resolveBrowserScopeKey', () => {
  test('collapses isolated chat directories onto the chats sentinel', () => {
    expect(resolveBrowserScopeKey(CHAT_A, HOME)).toBe(CHAT_DRAFT_PROJECT_ID);
    expect(resolveBrowserScopeKey(CHAT_B, HOME, new Set([PROJECT_A]))).toBe(CHAT_DRAFT_PROJECT_ID);
  });

  test('treats home-as-chat as the chats sentinel', () => {
    expect(resolveBrowserScopeKey(HOME, HOME)).toBe(CHAT_DRAFT_PROJECT_ID);
    expect(resolveBrowserScopeKey(HOME, HOME, new Set())).toBe(CHAT_DRAFT_PROJECT_ID);
  });

  test('keeps home as a project when it is an opened Settings project', () => {
    expect(resolveBrowserScopeKey(HOME, HOME, new Set([HOME]))).toBe(HOME);
  });

  test('keeps Settings projects on their normalized directory', () => {
    expect(resolveBrowserScopeKey(PROJECT_A, HOME)).toBe(PROJECT_A);
    expect(resolveBrowserScopeKey(`${PROJECT_B}/`, HOME, new Set([PROJECT_A, PROJECT_B]))).toBe(PROJECT_B);
    expect(resolveBrowserScopeKey(PROJECT_A, HOME)).not.toBe(resolveBrowserScopeKey(PROJECT_B, HOME));
  });

  test('is idempotent for the chats sentinel', () => {
    expect(resolveBrowserScopeKey(CHAT_DRAFT_PROJECT_ID, HOME)).toBe(CHAT_DRAFT_PROJECT_ID);
  });

  test('returns empty for a missing directory', () => {
    expect(resolveBrowserScopeKey('', HOME)).toBe('');
    expect(resolveBrowserScopeKey(null, HOME)).toBe('');
  });

  test('leaves a worktree path as its own project-like key', () => {
    const worktree = '/Users/tester/.pichamber/worktrees/project-a/feat';
    expect(resolveBrowserScopeKey(worktree, HOME, new Set([PROJECT_A]))).toBe(worktree);
  });
});

describe('openedProjectPathSet', () => {
  test('normalizes and drops empty paths', () => {
    expect(openedProjectPathSet([`${PROJECT_A}/`, '', null, PROJECT_B])).toEqual(
      new Set([PROJECT_A, PROJECT_B]),
    );
  });
});

describe('isBrowserTabIdentity', () => {
  test('recognizes singleton and per-url browser tab ids', () => {
    expect(isBrowserTabIdentity('browser')).toBe(true);
    expect(isBrowserTabIdentity('browser:https://example.com/')).toBe(true);
    expect(isBrowserTabIdentity('file')).toBe(false);
    expect(isBrowserTabIdentity('file:/repo/a.ts')).toBe(false);
  });
});

describe('mergeContextPanelForBrowserScope', () => {
  const fileTab = { id: 'file:/repo/a.ts', mode: 'file' };
  const browserTab = { id: 'browser:https://example.com/', mode: 'browser' };
  const gitTab = { id: 'git', mode: 'git' };

  test('returns the session state unchanged when the keys match', () => {
    const session = {
      isOpen: true,
      expanded: false,
      tabs: [fileTab, browserTab],
      activeTabId: browserTab.id,
      widthByMode: { browser: 640 },
      touchedAt: 1,
    };
    expect(mergeContextPanelForBrowserScope(PROJECT_A, session, PROJECT_A, session)).toBe(session);
  });

  test('merges scope browser tabs with session files when keys differ', () => {
    const session = {
      isOpen: true,
      expanded: false,
      tabs: [fileTab, gitTab],
      activeTabId: fileTab.id,
      widthByMode: { file: 500 },
      touchedAt: 1,
    };
    const scope = {
      isOpen: true,
      expanded: false,
      tabs: [browserTab],
      activeTabId: browserTab.id,
      widthByMode: { browser: 720 },
      touchedAt: 2,
    };

    const merged = mergeContextPanelForBrowserScope(CHAT_A, session, CHAT_DRAFT_PROJECT_ID, scope);
    expect(merged?.tabs.map((tab) => tab.id)).toEqual([fileTab.id, gitTab.id, browserTab.id]);
    expect(merged?.activeTabId).toBe(fileTab.id);
    expect(merged?.isOpen).toBe(true);
    expect(merged?.widthByMode.file).toBe(500);
    expect(merged?.widthByMode.browser).toBe(720);
  });

  test('keeps a session pointer at a browser tab that only lives on the scope', () => {
    const session = {
      isOpen: true,
      expanded: false,
      tabs: [fileTab],
      activeTabId: browserTab.id,
      widthByMode: {},
      touchedAt: 1,
    };
    const scope = {
      isOpen: false,
      expanded: false,
      tabs: [browserTab],
      activeTabId: browserTab.id,
      widthByMode: {},
      touchedAt: 2,
    };

    const merged = mergeContextPanelForBrowserScope(CHAT_A, session, CHAT_DRAFT_PROJECT_ID, scope);
    expect(merged?.tabs.map((tab) => tab.mode)).toEqual(['file', 'browser']);
    expect(merged?.activeTabId).toBe(browserTab.id);
  });

  test('does not double-count when session leftovers already exist on the scope', () => {
    const session = {
      isOpen: true,
      expanded: false,
      tabs: [browserTab],
      activeTabId: browserTab.id,
      widthByMode: {},
      touchedAt: 1,
    };
    const scope = {
      isOpen: false,
      expanded: false,
      tabs: [browserTab],
      activeTabId: browserTab.id,
      widthByMode: {},
      touchedAt: 2,
    };

    const merged = mergeContextPanelForBrowserScope(CHAT_A, session, CHAT_DRAFT_PROJECT_ID, scope);
    expect(merged?.tabs.filter((tab) => tab.id === browserTab.id)).toHaveLength(1);
  });
});

describe('mergeContextPanelChatScope', () => {
  const fileTab = { id: 'file:/repo/a.ts', mode: 'file' };
  const parentAChat = { id: 'session:child-a', mode: 'chat' };
  const parentBChat = { id: 'session:child-b', mode: 'chat' };

  test('hides another parent leftover chat when the current session has its own scope', () => {
    const directory = {
      isOpen: true,
      expanded: false,
      tabs: [fileTab, parentAChat],
      activeTabId: parentAChat.id,
      widthByMode: {},
      touchedAt: 1,
    };
    const sessionScope = {
      isOpen: true,
      expanded: false,
      tabs: [parentBChat],
      activeTabId: parentBChat.id,
      widthByMode: {},
      touchedAt: 2,
    };

    const merged = mergeContextPanelChatScope(PROJECT_A, directory, 'session:ses_b', sessionScope);
    expect(merged?.tabs.map((tab) => tab.id)).toEqual([fileTab.id, parentBChat.id]);
    expect(merged?.activeTabId).toBe(parentBChat.id);
    expect(merged?.isOpen).toBe(true);
  });

  test('keeps directory leftover chats when there is no session scope', () => {
    const directory = {
      isOpen: true,
      expanded: false,
      tabs: [fileTab, parentAChat],
      activeTabId: parentAChat.id,
      widthByMode: {},
      touchedAt: 1,
    };
    expect(mergeContextPanelChatScope(PROJECT_A, directory, '', undefined)).toBe(directory);
  });
});
