import { describe, expect, test } from 'bun:test';

describe('getSessionLiveActivity', () => {
  test('reports unknown when no child stores are mounted', async () => {
    const { getSessionLiveActivity, isSessionBusyNow } = await import('./session-actions');
    expect(getSessionLiveActivity('missing-session')).toBe('unknown');
    expect(isSessionBusyNow('missing-session')).toBe(false);
  });
});
