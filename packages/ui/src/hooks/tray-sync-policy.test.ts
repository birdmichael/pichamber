import { describe, expect, test } from 'bun:test';

import {
  TRAY_GLOBAL_REFRESH_MS,
  TRAY_STATUS_POLL_INTERVAL_MS,
  createTraySafetyPolls,
  shouldRunTraySafetyPolls,
  traySnapshotHasBusySession,
} from './tray-sync-policy';

describe('traySnapshotHasBusySession', () => {
  test('treats idle and empty snapshots as not busy', () => {
    expect(traySnapshotHasBusySession(null)).toBe(false);
    expect(traySnapshotHasBusySession({ sessions: [] })).toBe(false);
    expect(traySnapshotHasBusySession({ sessions: [{ status: 'idle' }] })).toBe(false);
  });

  test('treats busy or retry as a working session', () => {
    expect(traySnapshotHasBusySession({ sessions: [{ status: 'busy' }] })).toBe(true);
    expect(traySnapshotHasBusySession({
      sessions: [{ status: 'idle' }, { status: 'retry' }],
    })).toBe(true);
  });
});

describe('shouldRunTraySafetyPolls', () => {
  test('does not poll when the tray is disabled', () => {
    expect(shouldRunTraySafetyPolls({ trayEnabled: false, hasBusySession: true })).toBe(false);
    expect(shouldRunTraySafetyPolls({ trayEnabled: false, hasBusySession: false })).toBe(false);
  });

  test('does not poll when tray is on but every session is idle', () => {
    expect(shouldRunTraySafetyPolls({ trayEnabled: true, hasBusySession: false })).toBe(false);
  });

  test('polls only when the tray is on and a session is working', () => {
    expect(shouldRunTraySafetyPolls({ trayEnabled: true, hasBusySession: true })).toBe(true);
  });
});

describe('createTraySafetyPolls', () => {
  const createScheduler = () => {
    const intervals = new Map<number, { fn: () => void; ms: number }>();
    let nextId = 1;
    const calls = { status: 0, global: 0, flush: 0 };
    const scheduler = createTraySafetyPolls({
      setInterval: (fn, ms) => {
        const id = nextId;
        nextId += 1;
        intervals.set(id, { fn, ms });
        return id;
      },
      clearInterval: (id) => {
        intervals.delete(id);
      },
      onStatusPoll: () => { calls.status += 1; },
      onGlobalRefresh: () => { calls.global += 1; },
      onSafetyFlush: () => { calls.flush += 1; },
    });
    const tick = (ms: number) => {
      for (const interval of intervals.values()) {
        if (interval.ms === ms) interval.fn();
      }
    };
    return { scheduler, calls, tick, intervalCount: () => intervals.size };
  };

  test('does not arm 5s or 45s polls when tray is off or idle', () => {
    const { scheduler, calls, tick, intervalCount } = createScheduler();
    scheduler.sync({ trayEnabled: false, hasBusySession: true });
    expect(scheduler.isPolling()).toBe(false);
    expect(intervalCount()).toBe(0);

    scheduler.sync({ trayEnabled: true, hasBusySession: false });
    expect(scheduler.isPolling()).toBe(false);
    tick(TRAY_STATUS_POLL_INTERVAL_MS);
    tick(TRAY_GLOBAL_REFRESH_MS);
    expect(calls).toEqual({ status: 0, global: 0, flush: 0 });
  });

  test('a busy session starts both safety nets and idle stops them', () => {
    const { scheduler, calls, tick, intervalCount } = createScheduler();
    scheduler.sync({ trayEnabled: true, hasBusySession: true });
    expect(scheduler.isPolling()).toBe(true);
    expect(intervalCount()).toBe(3);

    tick(TRAY_STATUS_POLL_INTERVAL_MS);
    expect(calls.status).toBe(1);
    expect(calls.flush).toBe(1);
    expect(calls.global).toBe(0);

    tick(TRAY_GLOBAL_REFRESH_MS);
    expect(calls.global).toBe(1);

    scheduler.sync({ trayEnabled: true, hasBusySession: false });
    expect(scheduler.isPolling()).toBe(false);
    expect(intervalCount()).toBe(0);
    tick(TRAY_STATUS_POLL_INTERVAL_MS);
    tick(TRAY_GLOBAL_REFRESH_MS);
    expect(calls).toEqual({ status: 1, global: 1, flush: 1 });
  });
});
