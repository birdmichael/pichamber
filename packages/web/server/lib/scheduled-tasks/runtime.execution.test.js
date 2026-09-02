import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  sessionCreates: [],
  createOpencodeClient: vi.fn(() => ({
    session: {
      create: async ({ directory, title }) => {
        sdk.sessionCreates.push({ directory, title });
        return { data: { id: `oc-sess-${sdk.sessionCreates.length}` } };
      },
    },
    command: { list: async () => ({ data: [] }) },
  })),
}));

vi.mock('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: sdk.createOpencodeClient,
}));

import { createScheduledTasksRuntime } from './runtime.js';

const UTC = (y, mo, d, h, mi, s = 0) => Date.UTC(y, mo, d, h, mi, s);

const makeTask = (overrides = {}) => ({
  id: 'task-1',
  name: 'Daily Sync',
  enabled: true,
  schedule: { kind: 'daily', times: ['09:00'], timezone: 'UTC' },
  execution: {
    prompt: 'Summarize open issues',
    providerID: 'openai',
    modelID: 'gpt-4o',
    ...(overrides.execution || {}),
  },
  state: { createdAt: UTC(2026, 0, 1, 0, 0, 0), updatedAt: UTC(2026, 0, 1, 0, 0, 0) },
  ...overrides,
});

const createProjectConfigRuntime = (initialTask) => {
  let currentTask = structuredClone(initialTask);

  const applyPatch = (patch) => {
    const nextState = {
      ...(currentTask.state || {}),
      ...patch,
      updatedAt: Date.now(),
    };
    for (const key of ['nextRunAt', 'lastRunAt', 'lastDurationMs', 'lastScheduledFor', 'lastError', 'lastSessionId']) {
      if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] === undefined) {
        delete nextState[key];
      }
    }
    currentTask = { ...currentTask, state: nextState };
    return currentTask;
  };

  return {
    listScheduledTasks: vi.fn(async () => [structuredClone(currentTask)]),
    reconcileLoopTasks: vi.fn(async () => [structuredClone(currentTask)]),
    updateScheduledTaskState: vi.fn(async (_pid, _tid, patch) => {
      const task = applyPatch(patch);
      return { task: structuredClone(task), updated: true };
    }),
    updateScheduledTaskStateIf: vi.fn(async (_pid, _tid, predicate, patch) => {
      if (!predicate(currentTask)) {
        return { task: structuredClone(currentTask), updated: false };
      }
      const task = applyPatch(patch);
      return { task: structuredClone(task), updated: true };
    }),
    upsertScheduledTask: vi.fn(async (_pid, input) => {
      currentTask = structuredClone(input);
      return { task: structuredClone(currentTask) };
    }),
    getCurrentTask: () => currentTask,
  };
};

const createRuntime = ({ projectConfigRuntime, ...overrides }) => createScheduledTasksRuntime({
  projectConfigRuntime,
  listProjects: vi.fn(async () => [{ id: 'p1', path: '/repo' }]),
  buildOpenCodeUrl: () => 'http://127.0.0.1:9999/',
  getOpenCodeAuthHeaders: () => ({ authorization: 'Bearer test' }),
  waitForOpenCodeReady: async () => {},
  emitTaskRunEvent: vi.fn(),
  setSessionAutoAccept: vi.fn(async () => {}),
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  ...overrides,
});

describe('scheduled-tasks execution kernels', () => {
  beforeEach(() => {
    sdk.sessionCreates.length = 0;
    sdk.createOpencodeClient.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => '',
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the OpenCode SDK path when the Pi kernel is off', async () => {
    const projectConfigRuntime = createProjectConfigRuntime(makeTask());
    const runtime = createRuntime({
      projectConfigRuntime,
      isPiKernelEnabled: () => false,
      getPiHost: () => null,
    });

    await runtime.start();
    const result = await runtime.runNow('p1', 'task-1');
    runtime.stop();

    expect(result.ok).toBe(true);
    expect(result.sessionID).toBe('oc-sess-1');
    expect(sdk.createOpencodeClient).toHaveBeenCalledOnce();
    expect(sdk.sessionCreates).toEqual([
      { directory: '/repo', title: expect.stringContaining('Daily Sync') },
    ]);
    expect(fetch).toHaveBeenCalledOnce();
    const promptUrl = String(fetch.mock.calls[0][0]);
    expect(promptUrl).toContain('/session/oc-sess-1/prompt_async');
    expect(promptUrl).toContain('directory=%2Frepo');
    expect(projectConfigRuntime.getCurrentTask().state.lastSessionId).toBe('oc-sess-1');
    expect(projectConfigRuntime.getCurrentTask().state.lastStatus).toBe('success');
  });

  it('creates a Pi session in-process and does not call the OpenCode SDK', async () => {
    const projectConfigRuntime = createProjectConfigRuntime(makeTask());
    const host = {
      ready: vi.fn(async () => true),
      createSession: vi.fn(async ({ directory, title }) => ({
        id: 'ses_pi_1',
        info: { id: 'ses_pi_1', directory, title },
      })),
      setSessionModel: vi.fn(async (_id, ref) => ({ applied: true, model: ref })),
      setSessionThinking: vi.fn(async () => ({ applied: true, thinking: 'medium' })),
      promptAsync: vi.fn(async () => ({ info: { id: 'msg_1' } })),
      getDefaults: vi.fn(() => ({ model: 'anthropic/claude-sonnet' })),
    };
    const fetchImpl = vi.fn(async () => {
      throw new Error('fetch should not be called on the Pi kernel');
    });
    vi.stubGlobal('fetch', fetchImpl);

    const runtime = createRuntime({
      projectConfigRuntime,
      getPiHost: () => host,
      isPiKernelEnabled: () => true,
    });

    await runtime.start();
    const result = await runtime.runNow('p1', 'task-1');
    runtime.stop();

    expect(result.ok).toBe(true);
    expect(result.sessionID).toBe('ses_pi_1');
    expect(sdk.createOpencodeClient).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(host.createSession).toHaveBeenCalledWith({
      directory: '/repo',
      title: expect.stringContaining('Daily Sync'),
    });
    expect(host.setSessionModel).toHaveBeenCalledWith('ses_pi_1', 'openai/gpt-4o');
    expect(host.promptAsync).toHaveBeenCalledWith('ses_pi_1', {
      parts: [{ type: 'text', text: 'Summarize open issues' }],
      model: 'openai/gpt-4o',
    });
    expect(host.setSessionThinking).not.toHaveBeenCalled();
    expect(projectConfigRuntime.getCurrentTask().state.lastSessionId).toBe('ses_pi_1');
    expect(projectConfigRuntime.getCurrentTask().state.lastStatus).toBe('success');
  });

  it('falls back to Pi defaults when the task model is not a live Pi model', async () => {
    const projectConfigRuntime = createProjectConfigRuntime(makeTask());
    const host = {
      ready: vi.fn(async () => true),
      createSession: vi.fn(async () => ({ id: 'ses_pi_2', info: { id: 'ses_pi_2' } })),
      setSessionModel: vi.fn(async (_id, ref) => {
        if (ref === 'openai/gpt-4o') {
          const error = new Error('Unknown Pi model');
          error.status = 400;
          throw error;
        }
        return { applied: true, model: ref };
      }),
      promptAsync: vi.fn(async () => ({ info: { id: 'msg_2' } })),
      getDefaults: vi.fn(() => ({ model: 'example-provider/example-model' })),
    };

    const runtime = createRuntime({
      projectConfigRuntime,
      getPiHost: () => host,
      isPiKernelEnabled: () => true,
    });

    await runtime.start();
    const result = await runtime.runNow('p1', 'task-1');
    runtime.stop();

    expect(result.ok).toBe(true);
    expect(host.setSessionModel).toHaveBeenNthCalledWith(1, 'ses_pi_2', 'openai/gpt-4o');
    expect(host.setSessionModel).toHaveBeenNthCalledWith(2, 'ses_pi_2', 'example-provider/example-model');
    expect(host.promptAsync).toHaveBeenCalledWith('ses_pi_2', {
      parts: [{ type: 'text', text: 'Summarize open issues' }],
      model: 'example-provider/example-model',
    });
  });

  it('does not invent a provider when neither the task model nor Pi defaults apply', async () => {
    const projectConfigRuntime = createProjectConfigRuntime(makeTask({
      execution: { prompt: 'Ping', providerID: 'missing', modelID: 'nope' },
    }));
    const host = {
      createSession: vi.fn(async () => ({ id: 'ses_pi_3', info: { id: 'ses_pi_3' } })),
      setSessionModel: vi.fn(async () => {
        const error = new Error('Unknown Pi model');
        error.status = 400;
        throw error;
      }),
      promptAsync: vi.fn(async () => ({ info: { id: 'msg_3' } })),
      getDefaults: vi.fn(() => ({ model: '' })),
    };

    const runtime = createRuntime({
      projectConfigRuntime,
      getPiHost: () => host,
      isPiKernelEnabled: () => true,
    });

    await runtime.start();
    const result = await runtime.runNow('p1', 'task-1');
    runtime.stop();

    expect(result.ok).toBe(true);
    expect(host.promptAsync).toHaveBeenCalledWith('ses_pi_3', {
      parts: [{ type: 'text', text: 'Ping' }],
    });
    const promptBody = host.promptAsync.mock.calls[0][1];
    expect(promptBody.model).toBeUndefined();
  });

  it('skips OpenCode-only goal and auto-accept hooks on the Pi path', async () => {
    const projectConfigRuntime = createProjectConfigRuntime(makeTask({
      execution: {
        prompt: 'Do the work',
        providerID: 'openai',
        modelID: 'gpt-4o',
        goalEnabled: true,
        permissionAutoAccept: true,
      },
    }));
    const setSessionAutoAccept = vi.fn(async () => {});
    const host = {
      createSession: vi.fn(async () => ({ id: 'ses_pi_4', info: { id: 'ses_pi_4' } })),
      setSessionModel: vi.fn(async (_id, ref) => ({ applied: true, model: ref })),
      promptAsync: vi.fn(async () => ({ info: { id: 'msg_4' } })),
      getDefaults: vi.fn(() => ({ model: 'openai/gpt-4o' })),
    };

    const runtime = createRuntime({
      projectConfigRuntime,
      getPiHost: () => host,
      isPiKernelEnabled: () => true,
      setSessionAutoAccept,
    });

    await runtime.start();
    const result = await runtime.runNow('p1', 'task-1');
    runtime.stop();

    expect(result.ok).toBe(true);
    expect(setSessionAutoAccept).not.toHaveBeenCalled();
    expect(host.promptAsync).toHaveBeenCalledOnce();
  });

  it('applies the task thinking level on the Pi session and prompt', async () => {
    const projectConfigRuntime = createProjectConfigRuntime(makeTask({
      execution: {
        prompt: 'Analyze yesterday',
        providerID: 'xai',
        modelID: 'grok-4.6',
        variant: 'high',
      },
    }));
    const host = {
      ready: vi.fn(async () => true),
      createSession: vi.fn(async () => ({ id: 'ses_pi_5', info: { id: 'ses_pi_5' } })),
      setSessionModel: vi.fn(async (_id, ref) => ({ applied: true, model: ref })),
      setSessionThinking: vi.fn(async (_id, level) => ({ applied: true, thinking: level })),
      promptAsync: vi.fn(async () => ({ info: { id: 'msg_5' } })),
      getDefaults: vi.fn(() => ({ model: 'anthropic/claude-sonnet' })),
    };

    const runtime = createRuntime({
      projectConfigRuntime,
      getPiHost: () => host,
      isPiKernelEnabled: () => true,
    });

    await runtime.start();
    const result = await runtime.runNow('p1', 'task-1');
    runtime.stop();

    expect(result.ok).toBe(true);
    expect(host.setSessionModel).toHaveBeenCalledWith('ses_pi_5', 'xai/grok-4.6');
    expect(host.setSessionThinking).toHaveBeenCalledWith('ses_pi_5', 'high');
    expect(host.promptAsync).toHaveBeenCalledWith('ses_pi_5', {
      parts: [{ type: 'text', text: 'Analyze yesterday' }],
      model: 'xai/grok-4.6',
      variant: 'high',
    });
  });
});
