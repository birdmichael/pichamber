import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSessionRuntime } from './session-runtime.js';

describe('session runtime', () => {
  const runtimes = [];

  afterEach(() => {
    for (const runtime of runtimes) {
      runtime.dispose();
    }
    runtimes.length = 0;
  });

  it('broadcasts attention clears through the shared broadcaster', () => {
    const events = [];
    const runtime = createSessionRuntime({
      writeSseEvent() {
        throw new Error('SSE fallback should not be used when broadcastEvent is provided');
      },
      getNotificationClients: () => new Set(),
      broadcastEvent: (payload) => {
        events.push(payload);
      },
    });
    runtimes.push(runtime);

    runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: {
        sessionID: 'session-1',
        status: {
          type: 'busy',
        },
      },
    });
    runtime.markUserMessageSent('session-1');
    runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: {
        sessionID: 'session-1',
        status: {
          type: 'idle',
        },
      },
    });
    runtime.markSessionViewed('session-1', 'client-1');

    expect(events).toContainEqual({
      type: 'openchamber:session-status',
      properties: expect.objectContaining({
        sessionID: 'session-1',
        status: 'idle',
        needsAttention: true,
      }),
    });
    expect(events.at(-1)).toEqual({
      type: 'openchamber:session-status',
      properties: {
        sessionID: 'session-1',
        status: 'idle',
        timestamp: expect.any(Number),
        metadata: {},
        needsAttention: false,
      },
    });
  });

  it('accepts legacy session.status info.type payloads', () => {
    const events = [];
    const runtime = createSessionRuntime({
      writeSseEvent() {
        throw new Error('SSE fallback should not be used when broadcastEvent is provided');
      },
      getNotificationClients: () => new Set(),
      broadcastEvent: (payload) => {
        events.push(payload);
      },
    });
    runtimes.push(runtime);

    runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: {
        sessionID: 'legacy-session-1',
        info: {
          type: 'busy',
        },
      },
    });

    expect(events).toContainEqual({
      type: 'openchamber:session-status',
      properties: expect.objectContaining({
        sessionID: 'legacy-session-1',
        status: 'busy',
      }),
    });
  });

  it('broadcasts idle activity when cooldown expires', () => {
    vi.useFakeTimers();
    const events = [];
    const runtime = createSessionRuntime({
      writeSseEvent() {
        throw new Error('SSE fallback should not be used when broadcastEvent is provided');
      },
      getNotificationClients: () => new Set(),
      broadcastEvent: (payload) => {
        events.push(payload);
      },
    });

    try {
      runtime.processOpenCodeSsePayload({
        type: 'session.status',
        properties: {
          sessionID: 'session-activity-1',
          status: {
            type: 'busy',
          },
        },
      });
      runtime.processOpenCodeSsePayload({
        type: 'session.status',
        properties: {
          sessionID: 'session-activity-1',
          status: {
            type: 'idle',
          },
        },
      });

      const activityPhases = () => events
        .filter((event) => event.type === 'openchamber:session-activity')
        .map((event) => event.properties.phase);

      expect(activityPhases()).toEqual(['busy', 'cooldown']);

      vi.advanceTimersByTime(1999);
      expect(activityPhases()).toEqual(['busy', 'cooldown']);

      vi.advanceTimersByTime(1);

      expect(activityPhases()).toEqual(['busy', 'cooldown', 'idle']);
    } finally {
      runtime.dispose();
      vi.useRealTimers();
    }
  });

  it('maintains an idempotent active session count', () => {
    const runtime = createSessionRuntime({
      writeSseEvent() {},
      getNotificationClients: () => new Set(),
      broadcastEvent() {},
    });
    runtimes.push(runtime);
    const status = (sessionID, type) => runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: { sessionID, status: { type } },
    });

    expect(runtime.getActiveSessionCount()).toBe(0);
    status('session-1', 'busy');
    status('session-1', 'busy');
    status('session-1', 'retry');
    expect(runtime.getActiveSessionCount()).toBe(1);

    status('session-2', 'busy');
    expect(runtime.getActiveSessionCount()).toBe(2);

    status('session-1', 'idle');
    expect(runtime.getActiveSessionCount()).toBe(1);
    status('session-1', 'idle');
    expect(runtime.getActiveSessionCount()).toBe(1);

    runtime.resetAllSessionActivityToIdle();
    expect(runtime.getActiveSessionCount()).toBe(0);
  });

  it('restores activity when busy interrupts cooldown without timer underflow', () => {
    vi.useFakeTimers();
    const runtime = createSessionRuntime({
      writeSseEvent() {},
      getNotificationClients: () => new Set(),
      broadcastEvent() {},
    });
    const status = (type) => runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: { sessionID: 'session-1', status: { type } },
    });

    try {
      status('busy');
      status('idle');
      expect(runtime.getActiveSessionCount()).toBe(0);

      status('retry');
      expect(runtime.getActiveSessionCount()).toBe(1);
      vi.advanceTimersByTime(2000);

      expect(runtime.getActiveSessionCount()).toBe(1);
      expect(runtime.getSessionActivitySnapshot()['session-1']).toEqual({ type: 'busy' });
    } finally {
      runtime.dispose();
      vi.useRealTimers();
    }
  });

  it('releases retained session state when disposed', () => {
    const runtime = createSessionRuntime({
      writeSseEvent() {},
      getNotificationClients: () => new Set(),
      broadcastEvent() {},
    });
    runtimes.push(runtime);

    runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: { sessionID: 'session-1', status: { type: 'busy' } },
    });
    runtime.markUserMessageSent('session-1');
    runtime.dispose();

    expect(runtime.getActiveSessionCount()).toBe(0);
    expect(runtime.getSessionActivitySnapshot()).toEqual({});
    expect(runtime.getSessionStateSnapshot()).toEqual({});
    expect(runtime.getSessionAttentionSnapshot()).toEqual({});
  });

  it('interrupts busy and retry sessions after a kernel restart', () => {
    const events = [];
    const runtime = createSessionRuntime({
      writeSseEvent() {},
      getNotificationClients: () => new Set(),
      broadcastEvent: (event) => events.push(event),
    });
    runtimes.push(runtime);
    const status = (sessionID, type) => runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: { sessionID, status: { type } },
    });

    status('session-busy-1', 'busy');
    status('session-busy-2', 'retry');
    status('session-busy-3', 'busy');
    status('session-idle', 'idle');
    events.length = 0;

    expect(runtime.interruptBusySessionsAfterRestart()).toEqual({
      sessionIds: ['session-busy-1', 'session-busy-2', 'session-busy-3'],
    });
    expect(runtime.getActiveSessionCount()).toBe(0);
    expect(events.filter((event) => event.type === 'openchamber:session-status')).toHaveLength(3);
    expect(events.filter((event) => event.type === 'session.error')).toHaveLength(3);
    expect(events.filter((event) => event.type === 'session.error')[0].properties.error.name)
      .toBe('MessageAbortedError');

    events.length = 0;
    expect(runtime.interruptBusySessionsAfterRestart()).toEqual({ sessionIds: [] });
    expect(events).toEqual([]);
  });

  it('marks attention for a waiting pi.ui.asked while the session stays busy', () => {
    const events = [];
    const runtime = createSessionRuntime({
      writeSseEvent() {
        throw new Error('SSE fallback should not be used when broadcastEvent is provided');
      },
      getNotificationClients: () => new Set(),
      broadcastEvent: (payload) => {
        events.push(payload);
      },
    });
    runtimes.push(runtime);

    runtime.processOpenCodeSsePayload({
      type: 'session.status',
      properties: {
        sessionID: 'session-ask',
        status: { type: 'busy' },
      },
    });
    runtime.processOpenCodeSsePayload({
      type: 'pi.ui.asked',
      properties: {
        sessionID: 'session-ask',
        prompt: { id: 'pui_1', kind: 'select', status: 'pending' },
      },
    });

    expect(runtime.getSessionAttentionState('session-ask')).toEqual(expect.objectContaining({
      needsAttention: true,
      isViewed: false,
      status: 'busy',
    }));
    expect(events).toContainEqual({
      type: 'openchamber:session-status',
      properties: expect.objectContaining({
        sessionID: 'session-ask',
        status: 'busy',
        needsAttention: true,
      }),
    });
  });

  it('does not mark attention for a waiting prompt the current client is viewing', () => {
    const runtime = createSessionRuntime({
      writeSseEvent() {},
      getNotificationClients: () => new Set(),
      broadcastEvent() {},
    });
    runtimes.push(runtime);

    runtime.markSessionViewed('session-viewed', 'client-1');
    runtime.processOpenCodeSsePayload({
      type: 'question.asked',
      properties: { sessionID: 'session-viewed' },
    });

    expect(runtime.getSessionAttentionState('session-viewed')).toEqual(expect.objectContaining({
      needsAttention: false,
      isViewed: true,
    }));

    runtime.markSessionUnviewed('session-viewed', 'client-1');
    expect(runtime.getSessionAttentionState('session-viewed')).toEqual(expect.objectContaining({
      needsAttention: true,
      isViewed: false,
    }));
  });
});
