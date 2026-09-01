import { beforeEach, describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';
import { navigateSessionHistory, resetSessionNavigationHistoryForTests } from './sessionNavigationHistory';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';

// SAFETY: the history module only reads a session's id and directory metadata.
const session = (id: string): Session => ({
  id,
  title: id,
  directory: '/repo',
  time: { created: 1, updated: 1 },
} as Session);

describe('sessionNavigationHistory', () => {
  beforeEach(() => {
    resetSessionNavigationHistoryForTests();
    useSessionUIStore.getState().setCurrentSession(null);
    useGlobalSessionsStore.setState({
      activeSessions: [session('s1'), session('s2'), session('s3')],
      archivedSessions: [],
      sessionsByDirectory: new Map(),
      hasLoaded: true,
      status: 'ready',
    });
  });

  test('steps back and forward through the visit order', () => {
    useSessionUIStore.setState({ currentSessionId: 's1' });
    useSessionUIStore.setState({ currentSessionId: 's2' });
    useSessionUIStore.setState({ currentSessionId: 's3' });

    expect(navigateSessionHistory(-1)).toBe(true);
    expect(useSessionUIStore.getState().currentSessionId).toBe('s2');
    expect(navigateSessionHistory(-1)).toBe(true);
    expect(useSessionUIStore.getState().currentSessionId).toBe('s1');
    expect(navigateSessionHistory(-1)).toBe(false);

    expect(navigateSessionHistory(1)).toBe(true);
    expect(useSessionUIStore.getState().currentSessionId).toBe('s2');
  });

  test('a fresh visit truncates the forward branch', () => {
    useSessionUIStore.setState({ currentSessionId: 's1' });
    useSessionUIStore.setState({ currentSessionId: 's2' });
    useSessionUIStore.setState({ currentSessionId: 's3' });
    expect(navigateSessionHistory(-1)).toBe(true);
    expect(useSessionUIStore.getState().currentSessionId).toBe('s2');

    useSessionUIStore.setState({ currentSessionId: 's1' });
    expect(navigateSessionHistory(1)).toBe(false);
    expect(navigateSessionHistory(-1)).toBe(true);
    expect(useSessionUIStore.getState().currentSessionId).toBe('s2');
  });

  test('does not wipe history while the session list is still loading', () => {
    useSessionUIStore.setState({ currentSessionId: 's1' });
    useSessionUIStore.setState({ currentSessionId: 's2' });
    useGlobalSessionsStore.setState({
      activeSessions: [],
      hasLoaded: false,
      status: 'loading',
    });
    expect(navigateSessionHistory(-1)).toBe(false);
    expect(useSessionUIStore.getState().currentSessionId).toBe('s2');
    useGlobalSessionsStore.setState({
      activeSessions: [session('s1'), session('s2'), session('s3')],
      hasLoaded: true,
      status: 'ready',
    });
    expect(navigateSessionHistory(-1)).toBe(true);
    expect(useSessionUIStore.getState().currentSessionId).toBe('s1');
  });

  test('skips and drops entries whose session no longer exists', () => {
    useSessionUIStore.setState({ currentSessionId: 's1' });
    useSessionUIStore.setState({ currentSessionId: 's2' });
    useSessionUIStore.setState({ currentSessionId: 's3' });
    useGlobalSessionsStore.setState({ activeSessions: [session('s1'), session('s3')] });
    expect(navigateSessionHistory(-1)).toBe(true);
    expect(useSessionUIStore.getState().currentSessionId).toBe('s1');
  });
});
