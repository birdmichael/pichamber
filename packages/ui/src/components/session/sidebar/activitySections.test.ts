import { describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';
import { deriveRecentSessions, selectRecentSessionsWithoutWorkspaceGroup } from './activitySections';

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
