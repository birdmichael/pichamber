import { describe, expect, test } from 'bun:test';

import { MOBILE_SESSION_CHROME_KEYS } from './mobileSessionChromeKeys';

describe('mobileSessionChromeKeys', () => {
  test('reuses Desktop sidebar keys for Archive, Refresh, Scheduled, and Multi-run', () => {
    expect(MOBILE_SESSION_CHROME_KEYS).toEqual({
      archive: 'sessions.sidebar.nav.archive',
      refresh: 'sessions.sidebar.footer.actions.refresh',
      scheduledTasks: 'sessions.sidebar.header.actions.scheduledTasks',
      newMultiRun: 'sessions.sidebar.header.actions.newMultiRun',
      untitled: 'sessions.sidebar.session.untitled',
    });
  });
});
