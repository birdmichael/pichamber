import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionAssistRuntime } from './runtime.js';

const SESSION_ID = 'ses_assist';
const DIRECTORY = '/workspace';

describe('session assist Pi kernel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does not generate leftover Recap or suggestion on the Pi kernel', async () => {
    const host = {
      getSession: vi.fn(),
      getMessages: vi.fn(),
      updateSession: vi.fn(),
    };
    const service = {
      generateSmallModelText: vi.fn(async () => ({
        text: '{"recap":"Said hello","suggestion":"Ask a follow-up"}',
        providerID: 'provider',
        modelID: 'model',
      })),
    };
    const runtime = createSessionAssistRuntime({
      buildOpenCodeUrl: (pathname) => `http://127.0.0.1:3901${pathname}`,
      getOpenCodeAuthHeaders: () => ({}),
      getSmallModelService: async () => service,
      getPiHost: () => host,
      isPiKernelEnabled: () => true,
      quietMs: 10,
    });

    runtime.processPayload({
      type: 'session.status',
      properties: { sessionID: SESSION_ID, status: { type: 'idle' }, directory: DIRECTORY },
    });
    await vi.advanceTimersByTimeAsync(10);

    expect(service.generateSmallModelText).not.toHaveBeenCalled();
    expect(host.getSession).not.toHaveBeenCalled();
    expect(host.updateSession).not.toHaveBeenCalled();
    runtime.stop();
  });

  it('still generates Recap on leftover OpenCode when Pi is off', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes('/message')) {
        return {
          ok: true,
          json: async () => ([
            {
              info: { id: 'msg_user', role: 'user', time: { created: 1 } },
              parts: [{ type: 'text', text: 'Hello' }],
            },
            {
              info: {
                id: 'msg_assistant',
                role: 'assistant',
                parentID: 'msg_user',
                providerID: 'provider',
                modelID: 'model',
              },
              parts: [{ type: 'text', text: 'Hi there' }],
            },
          ]),
        };
      }
      return {
        ok: true,
        json: async () => ({ id: SESSION_ID, directory: DIRECTORY, metadata: {} }),
      };
    });
    const service = {
      generateSmallModelText: vi.fn(async () => ({
        text: '{"recap":"Said hello","suggestion":"Ask a follow-up"}',
        providerID: 'provider',
        modelID: 'model',
      })),
    };
    vi.stubGlobal('fetch', fetchImpl);
    const runtime = createSessionAssistRuntime({
      buildOpenCodeUrl: (pathname) => `http://127.0.0.1:3901${pathname}`,
      getOpenCodeAuthHeaders: () => ({}),
      getSmallModelService: async () => service,
      getPiHost: () => null,
      isPiKernelEnabled: () => false,
      quietMs: 10,
    });

    runtime.processPayload({
      type: 'session.status',
      properties: { sessionID: SESSION_ID, status: { type: 'idle' }, directory: DIRECTORY },
    });
    await vi.advanceTimersByTimeAsync(10);

    expect(service.generateSmallModelText).toHaveBeenCalledOnce();
    runtime.stop();
  });

  it('does not generate recap after a /goal turn', async () => {
    const host = {
      getSession: vi.fn(() => ({
        info: { id: SESSION_ID, directory: DIRECTORY, metadata: {} },
      })),
      getMessages: vi.fn(() => [
        {
          info: { id: 'msg_goal', role: 'user', time: { created: 1 } },
          parts: [{ type: 'text', text: '/goal say bye' }],
        },
        {
          info: {
            id: 'msg_done',
            role: 'assistant',
            parentID: 'msg_goal',
            providerID: 'provider',
            modelID: 'model',
          },
          parts: [{ type: 'text', text: 'Goal complete' }],
        },
      ]),
      updateSession: vi.fn(),
    };
    const service = {
      generateSmallModelText: vi.fn(async () => ({
        text: '{"recap":"Requested a reply of just ok","suggestion":"Confirm you are ready for the next task."}',
        providerID: 'provider',
        modelID: 'model',
      })),
    };
    const runtime = createSessionAssistRuntime({
      buildOpenCodeUrl: (pathname) => `http://127.0.0.1:3901${pathname}`,
      getOpenCodeAuthHeaders: () => ({}),
      getSmallModelService: async () => service,
      getPiHost: () => host,
      isPiKernelEnabled: () => true,
      quietMs: 10,
    });

    runtime.processPayload({
      type: 'session.status',
      properties: { sessionID: SESSION_ID, status: { type: 'idle' }, directory: DIRECTORY },
    });
    await vi.advanceTimersByTimeAsync(10);

    expect(service.generateSmallModelText).not.toHaveBeenCalled();
    expect(host.updateSession).not.toHaveBeenCalled();
    runtime.stop();
  });
});
