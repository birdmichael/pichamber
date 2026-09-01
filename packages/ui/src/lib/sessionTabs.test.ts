import { beforeEach, describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';

import { useSessionTabsStore } from '@/stores/useSessionTabsStore';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { useSessionUIStore } from '@/sync/session-ui-store';

import {
  activateAdjacentSessionTab,
  activateSessionTabByIndex,
  closeSessionTabAndActivateNeighbour,
} from './sessionTabs';

const buildSession = (id: string, directory: string): Session => ({
  id,
  title: id,
  directory,
  time: { created: 1, updated: 2 },
} as Session);

const activeIds = () => useGlobalSessionsStore.getState().activeSessions.map((session) => session.id);

describe('sessionTabs', () => {
  beforeEach(() => {
    useSessionTabsStore.setState({ tabIds: [] });
    useSessionUIStore.getState().setCurrentSession(null);
    useGlobalSessionsStore.setState({
      activeSessions: [
        buildSession('ses_a', '/projects/a'),
        buildSession('ses_b', '/projects/b'),
        buildSession('ses_c', '/projects/c'),
      ],
      archivedSessions: [],
      sessionsByDirectory: new Map(),
      hasLoaded: true,
      status: 'ready',
    });
  });

  test('closeSessionTabAndActivateNeighbour does not archive or delete the session', () => {
    useSessionTabsStore.setState({ tabIds: ['ses_a', 'ses_b', 'ses_c'] });
    useSessionUIStore.getState().setCurrentSession('ses_b', '/projects/b');

    closeSessionTabAndActivateNeighbour('ses_b');

    expect(useSessionTabsStore.getState().tabIds).toEqual(['ses_a', 'ses_c']);
    expect(activeIds()).toEqual(['ses_a', 'ses_b', 'ses_c']);
    expect(useGlobalSessionsStore.getState().archivedSessions).toEqual([]);
  });

  test('closing the active tab activates its right neighbour', () => {
    useSessionTabsStore.setState({ tabIds: ['ses_a', 'ses_b', 'ses_c'] });
    useSessionUIStore.getState().setCurrentSession('ses_b', '/projects/b');

    closeSessionTabAndActivateNeighbour('ses_b');

    expect(useSessionUIStore.getState().currentSessionId).toBe('ses_c');
    expect(useSessionUIStore.getState().currentSessionDirectory).toBe('/projects/c');
  });

  test('closing an inactive tab keeps the current session selected', () => {
    useSessionTabsStore.setState({ tabIds: ['ses_a', 'ses_b', 'ses_c'] });
    useSessionUIStore.getState().setCurrentSession('ses_a', '/projects/a');

    closeSessionTabAndActivateNeighbour('ses_c');

    expect(useSessionUIStore.getState().currentSessionId).toBe('ses_a');
    expect(useSessionTabsStore.getState().tabIds).toEqual(['ses_a', 'ses_b']);
    expect(activeIds()).toEqual(['ses_a', 'ses_b', 'ses_c']);
  });

  test('closing the last tab opens a new-session draft without deleting', () => {
    useSessionTabsStore.setState({ tabIds: ['ses_a'] });
    useSessionUIStore.getState().setCurrentSession('ses_a', '/projects/a');

    closeSessionTabAndActivateNeighbour('ses_a');

    expect(useSessionTabsStore.getState().tabIds).toEqual([]);
    expect(useSessionUIStore.getState().newSessionDraft.open).toBe(true);
    expect(activeIds()).toEqual(['ses_a', 'ses_b', 'ses_c']);
    expect(useGlobalSessionsStore.getState().archivedSessions).toEqual([]);
  });

  test('activateSessionTabByIndex uses renderable tabs only', () => {
    useSessionTabsStore.setState({ tabIds: ['ses_missing', 'ses_a', 'ses_b'] });

    expect(activateSessionTabByIndex(0)).toBe(true);
    expect(useSessionUIStore.getState().currentSessionId).toBe('ses_a');
    expect(activateSessionTabByIndex(2)).toBe(false);
  });

  test('activateAdjacentSessionTab wraps around the rendered strip', () => {
    useSessionTabsStore.setState({ tabIds: ['ses_a', 'ses_b'] });
    useSessionUIStore.getState().setCurrentSession('ses_b', '/projects/b');

    expect(activateAdjacentSessionTab(1)).toBe(true);
    expect(useSessionUIStore.getState().currentSessionId).toBe('ses_a');
    expect(activateAdjacentSessionTab(-1)).toBe(true);
    expect(useSessionUIStore.getState().currentSessionId).toBe('ses_b');
  });
});
