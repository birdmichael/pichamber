import { describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';
import {
  countSidebarSearchMatches,
  deriveRecentSessions,
  selectRecentSessionsWithoutWorkspaceGroup,
  shouldShowSidebarActivitySections,
} from './activitySections';

const NOW = 200_000_000;
const RECENT = NOW - (48 * 60 * 60 * 1000);
const OLD = NOW - (72 * 60 * 60 * 1000);

const session = (id: string, options: { parentID?: string; archived?: number; updated?: number } = {}): Session => ({
  id,
  parentID: options.parentID,
  time: { created: OLD, updated: options.updated ?? OLD, archived: options.archived },
} as Session);

describe('deriveRecentSessions', () => {
  test('includes an old root session while it is active', () => {
    const oldActive = session('old-active');

    expect(deriveRecentSessions([oldActive], new Set([oldActive.id]), NOW)).toEqual([oldActive]);
  });

  test('does not promote active children or archived sessions into Recent', () => {
    const child = session('child', { parentID: 'parent' });
    const archived = session('archived', { archived: NOW - 1 });

    expect(deriveRecentSessions(
      [child, archived],
      new Set([child.id, archived.id]),
      NOW,
    )).toEqual([]);
  });

  test('keeps inactive membership timestamp-based', () => {
    const oldSession = session('old');
    const recentSession = session('recent', { updated: RECENT });

    expect(deriveRecentSessions([oldSession, recentSession], new Set(), NOW)).toEqual([recentSession]);
  });
});

describe('selectRecentSessionsWithoutWorkspaceGroup', () => {
  test('drops sessions that already have a workspace group, including the active one', () => {
    const workspaceActive = session('workspace-active');
    const workspaceRecent = session('workspace-recent', { updated: RECENT });
    const orphan = session('orphan', { updated: RECENT });
    const recent = deriveRecentSessions(
      [workspaceActive, workspaceRecent, orphan],
      new Set([workspaceActive.id]),
      NOW,
    );

    expect(selectRecentSessionsWithoutWorkspaceGroup(
      recent,
      new Set([workspaceActive.id, workspaceRecent.id]),
    )).toEqual([orphan]);
  });

  test('keeps ungrouped roots so Recent can still host leftover sessions', () => {
    const orphanActive = session('orphan-active');
    const recent = deriveRecentSessions([orphanActive], new Set([orphanActive.id]), NOW);

    expect(selectRecentSessionsWithoutWorkspaceGroup(recent, new Set())).toEqual([orphanActive]);
  });
});

describe('shouldShowSidebarActivitySections', () => {
  test('idle keeps the chats block via hasActivitySectionItems even when empty', () => {
    expect(shouldShowSidebarActivitySections({
      isVSCode: false,
      hasSessionSearchQuery: false,
      hasActivitySectionItems: true,
      activitySections: [{ items: [] }],
    })).toBe(true);
  });

  test('does not hide activity solely because a search query is present', () => {
    expect(shouldShowSidebarActivitySections({
      isVSCode: false,
      hasSessionSearchQuery: true,
      hasActivitySectionItems: true,
      activitySections: [{ items: [{ id: 'renamed-scan' }] }],
    })).toBe(true);
  });

  test('search hides the block when every chats/recent section is empty', () => {
    expect(shouldShowSidebarActivitySections({
      isVSCode: false,
      hasSessionSearchQuery: true,
      hasActivitySectionItems: true,
      activitySections: [{ items: [] }, { items: [] }],
    })).toBe(false);
  });

  test('VS Code never shows the activity block', () => {
    expect(shouldShowSidebarActivitySections({
      isVSCode: true,
      hasSessionSearchQuery: true,
      hasActivitySectionItems: true,
      activitySections: [{ items: [{ id: 'renamed-scan' }] }],
    })).toBe(false);
  });
});

describe('countSidebarSearchMatches', () => {
  test('adds chats and recent hits to project matches', () => {
    expect(countSidebarSearchMatches(true, 2, [
      { items: [{ id: 'chat-a' }, { id: 'chat-b' }] },
      { items: [{ id: 'recent-a' }] },
    ])).toBe(5);
  });

  test('is zero without a query even if sections have rows', () => {
    expect(countSidebarSearchMatches(false, 2, [{ items: [{ id: 'chat-a' }] }])).toBe(0);
  });
});

