import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNotificationTriggerRuntime } from './runtime.js';

const originalFetch = globalThis.fetch;

const assistantHop = (sessionId, extras = {}) => ({
  type: 'message.updated',
  properties: {
    info: {
      id: extras.id || 'msg_hop',
      sessionID: sessionId,
      role: 'assistant',
      finish: 'stop',
      mode: extras.mode || 'pi',
      modelID: extras.modelID || 'example-model',
      ...extras.info,
    },
  },
});

const sessionIdle = (sessionId) => ({
  type: 'session.idle',
  properties: { sessionID: sessionId },
});

const createRuntime = ({
  settings = {},
  sessionById = {},
} = {}) => {
  const emitDesktopNotification = vi.fn(() => true);
  const broadcastUiNotification = vi.fn();
  const sendPushToAllUiSessions = vi.fn(async () => {});
  const sendApnsToAllUiSessions = vi.fn(async () => {});

  globalThis.fetch = vi.fn(async (url) => {
    const href = String(url);
    const match = href.match(/\/session\/([^/?]+)/);
    const sessionId = match ? decodeURIComponent(match[1]) : '';
    const session = sessionById[sessionId] ?? { id: sessionId };
    return new Response(JSON.stringify(session), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  const runtime = createNotificationTriggerRuntime({
    readSettingsFromDisk: async () => ({
      nativeNotificationsEnabled: true,
      notifyOnCompletion: true,
      notifyOnSubtasks: true,
      notifyOnError: true,
      notificationMode: 'always',
      ...settings,
    }),
    prepareNotificationLastMessage: async ({ message }) => message || '',
    buildTemplateVariables: async (payload, sessionId) => ({
      session_name: 'Demo session',
      agent_name: payload?.properties?.info?.mode === 'pi' ? 'Pi' : 'Agent',
      model_name: payload?.properties?.info?.modelID || 'Assistant',
      last_message: '',
      session_id: sessionId,
    }),
    extractLastMessageText: () => '',
    fetchLastAssistantMessageText: async () => 'final answer',
    resolveNotificationTemplate: (template, variables) => {
      if (!template || typeof template !== 'string') return '';
      return template.replace(/\{(\w+)\}/g, (_match, key) => (
        variables[key] == null ? '' : String(variables[key])
      ));
    },
    shouldApplyResolvedTemplateMessage: () => true,
    emitDesktopNotification,
    broadcastUiNotification,
    sendPushToAllUiSessions,
    sendApnsToAllUiSessions,
    isAnyInteractiveClientVisible: () => false,
    buildOpenCodeUrl: (path) => path,
    getOpenCodeAuthHeaders: () => ({}),
  });

  return {
    runtime,
    emitDesktopNotification,
    broadcastUiNotification,
    sendPushToAllUiSessions,
  };
};

const readyCalls = (emitDesktopNotification) => (
  emitDesktopNotification.mock.calls
    .map((call) => call[0])
    .filter((payload) => payload?.kind === 'ready')
);

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

describe('notification trigger ready fanout', () => {
  it('does not emit ready after a thinking or tool hop message_end', async () => {
    const { runtime, emitDesktopNotification } = createRuntime();

    await runtime.maybeSendPushForTrigger(assistantHop('ses_1', {
      id: 'msg_think',
      modelID: 'example-model',
    }));

    expect(readyCalls(emitDesktopNotification)).toEqual([]);
  });

  it('emits ready on session.idle after the agent settled', async () => {
    const { runtime, emitDesktopNotification } = createRuntime();

    await runtime.maybeSendPushForTrigger(assistantHop('ses_1', {
      id: 'msg_final',
      modelID: 'example-model',
    }));
    await runtime.maybeSendPushForTrigger(sessionIdle('ses_1'));

    expect(readyCalls(emitDesktopNotification)).toEqual([
      expect.objectContaining({
        kind: 'ready',
        sessionId: 'ses_1',
        tag: 'ready-ses_1',
        title: 'Pi is ready',
        body: 'example-model completed the task',
      }),
    ]);
  });

  it('does not let an intermediate hop consume the ready cooldown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const { runtime, emitDesktopNotification } = createRuntime();

    await runtime.maybeSendPushForTrigger(assistantHop('ses_1'));
    vi.advanceTimersByTime(1000);
    await runtime.maybeSendPushForTrigger(sessionIdle('ses_1'));

    expect(readyCalls(emitDesktopNotification)).toHaveLength(1);
  });

  it('still notifies a child session idle when subagent completion is on', async () => {
    const { runtime, emitDesktopNotification } = createRuntime({
      sessionById: {
        'ses_child': { id: 'ses_child', parentID: 'ses_parent' },
      },
    });

    await runtime.maybeSendPushForTrigger(assistantHop('ses_child', { mode: 'explore' }));
    await runtime.maybeSendPushForTrigger(sessionIdle('ses_child'));

    expect(readyCalls(emitDesktopNotification)).toEqual([
      expect.objectContaining({
        kind: 'ready',
        sessionId: 'ses_child',
        tag: 'ready-ses_child',
      }),
    ]);
  });

  it('suppresses child session idle when subagent completion is off', async () => {
    const { runtime, emitDesktopNotification } = createRuntime({
      settings: { notifyOnSubtasks: false },
      sessionById: {
        'ses_child': { id: 'ses_child', parentID: 'ses_parent' },
      },
    });

    await runtime.maybeSendPushForTrigger(assistantHop('ses_child'));
    await runtime.maybeSendPushForTrigger(sessionIdle('ses_child'));

    expect(readyCalls(emitDesktopNotification)).toEqual([]);
  });

  it('emits ready on session.idle even when no prior assistant hop was cached', async () => {
    const { runtime, emitDesktopNotification } = createRuntime();

    await runtime.maybeSendPushForTrigger(sessionIdle('ses_1'));

    expect(readyCalls(emitDesktopNotification)).toEqual([
      expect.objectContaining({
        kind: 'ready',
        sessionId: 'ses_1',
        tag: 'ready-ses_1',
      }),
    ]);
  });

  it('swallows a second session.idle on the same session within the ready cooldown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const { runtime, emitDesktopNotification } = createRuntime();

    await runtime.maybeSendPushForTrigger(sessionIdle('ses_1'));
    vi.advanceTimersByTime(1000);
    await runtime.maybeSendPushForTrigger(sessionIdle('ses_1'));

    expect(readyCalls(emitDesktopNotification)).toHaveLength(1);
  });

  it('still emits error notifications from assistant finish error', async () => {
    const { runtime, emitDesktopNotification } = createRuntime();

    await runtime.maybeSendPushForTrigger({
      type: 'message.updated',
      properties: {
        info: {
          sessionID: 'ses_1',
          role: 'assistant',
          finish: 'error',
        },
      },
    });

    expect(emitDesktopNotification).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      sessionId: 'ses_1',
    }));
  });
});
