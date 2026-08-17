import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpenChamberControlService } from '../openchamber-control/service.js';

const MESSAGE_FIXTURE = [
  {
    info: { id: 'msg_assistant', role: 'assistant', providerID: 'openai', modelID: 'gpt-5.4-mini', time: { created: 20, completed: 30 } },
    parts: [{ type: 'reasoning', text: 'hidden' }, { type: 'text', text: 'First ' }, { type: 'tool' }, { type: 'text', text: 'answer' }],
  },
  { info: { id: 'msg_user', role: 'user', time: { created: 10 } }, parts: [{ type: 'text', text: 'Question' }] },
  { info: { id: 'msg_tool', role: 'assistant', time: { created: 15 } }, parts: [{ type: 'tool' }] },
];

const createPiService = ({ host, createWorktree, getWorktreeBootstrapStatus, now, sleep, settings } = {}) => {
  let messages = [];
  const defaultHost = {
    ready: vi.fn(async () => true),
    createSession: vi.fn(async ({ directory, title } = {}) => ({
      id: 'ses_1',
      directory,
      info: { id: 'ses_1', title, directory },
    })),
    setSessionModel: vi.fn(async (_id, ref) => ({ applied: true, model: ref })),
    setSessionThinking: vi.fn(async (_id, level) => ({ applied: true, thinking: level })),
    promptAsync: vi.fn(async (_id, body) => {
      messages.push({
        info: { id: `msg_user_${messages.length + 1}`, role: 'user', time: { created: Date.now() } },
        parts: [{ type: 'text', text: body?.parts?.[0]?.text || '' }],
      });
      return {};
    }),
    forkSession: vi.fn(async (source, messageId) => ({
      id: 'ses_fork',
      directory: '/repo',
      info: { id: 'ses_fork', title: 'Fork', parentID: source },
      messageId,
    })),
    runCommand: vi.fn(async () => ({})),
    getMessages: vi.fn(() => messages),
    getStatus: vi.fn(() => ({})),
    getDefaults: vi.fn(() => ({
      model: 'example-provider/example-model',
      thinking: 'medium',
      enabledModels: ['example-provider/example-model'],
    })),
    getProviders: vi.fn(async () => ({
      providers: [{
        id: 'example-provider',
        models: { 'example-model': { id: 'example-model' } },
      }],
    })),
    getFeaturePlugins: vi.fn(() => ({ slots: { goal: { installed: false, enabled: false } } })),
    listSessionInfos: vi.fn(async () => []),
    listSessions: vi.fn(() => []),
    getSession: vi.fn((id) => ({ id, directory: '/repo' })),
    ensureSession: vi.fn(async () => ({})),
    ...host,
  };
  if (host?.getMessages) {
    defaultHost.getMessages = host.getMessages;
  } else {
    defaultHost.getMessages = vi.fn(() => messages);
  }
  if (host?.promptAsync) {
    defaultHost.promptAsync = host.promptAsync;
  }

  const createClient = vi.fn(() => {
    throw new Error('createOpencodeClient must not be called on the Pi kernel');
  });
  const sessionService = {
    create: vi.fn(),
    send: vi.fn(),
    fork: vi.fn(),
  };
  const scheduledTaskService = {
    status: vi.fn(async () => ({ enabledScheduledTasksCount: 0 })),
    resolveProjectID: vi.fn(async () => 'project-1'),
    list: vi.fn(async () => []),
    upsert: vi.fn(async () => ({ task: { id: 'task-1' }, created: true })),
    run: vi.fn(async () => ({ ok: true, sessionID: 'ses_task' })),
    remove: vi.fn(),
    setEnabled: vi.fn(),
  };
  const fetchImpl = vi.fn(async () => {
    throw new Error('fetch should not be called on the Pi kernel');
  });
  vi.stubGlobal('fetch', fetchImpl);

  const service = createOpenChamberControlService({
    readSettingsFromDiskMigrated: vi.fn(async () => ({
      projects: [{ id: 'project-1', path: '/repo', label: 'Repo' }],
      defaultModel: 'leftover/opencode',
      favoriteModels: ['leftover/opencode'],
      recentModels: ['leftover/recent'],
      ...settings,
    })),
    sanitizeProjects: (projects) => projects,
    buildOpenCodeUrl: () => 'http://127.0.0.1:4096/',
    getOpenCodeAuthHeaders: () => ({ authorization: 'Basic test' }),
    waitForOpenCodeReady: vi.fn(),
    createClient,
    sessionService,
    scheduledTaskService,
    getPiHost: () => defaultHost,
    isPiKernelEnabled: () => true,
    createWorktree: createWorktree || vi.fn(async (_directory, input) => ({
      path: '/repo/worktrees/side',
      name: input?.name || 'side',
    })),
    getWorktreeBootstrapStatus: getWorktreeBootstrapStatus || vi.fn(async () => ({
      status: 'ready',
      phase: 'git-ready',
    })),
    now,
    sleep,
  });

  return {
    service,
    host: defaultHost,
    createClient,
    sessionService,
    scheduledTaskService,
    fetchImpl,
    messages,
    setMessages: (next) => { messages = next; },
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Pi-safe pichamber session path', () => {
  it('creates a session in-process and does not call fetch or the OpenCode SDK', async () => {
    const { service, host, createClient, sessionService, fetchImpl } = createPiService();
    await expect(service.execute('session.create', { directory: '/repo', title: 'from-tool' })).resolves.toEqual(
      expect.objectContaining({ sessionId: 'ses_1', directory: '/repo', title: 'from-tool', promptDispatched: false }),
    );
    expect(host.createSession).toHaveBeenCalledWith({ directory: '/repo', title: 'from-tool' });
    expect(createClient).not.toHaveBeenCalled();
    expect(sessionService.create).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sets a live model then promptAsync and reports promptDispatched after a user message', async () => {
    const { service, host } = createPiService({
      host: {
        getProviders: vi.fn(async () => ({
          providers: [{ id: 'openai', models: { 'gpt-4o': { id: 'gpt-4o' } } }],
        })),
      },
    });
    await expect(service.execute('session.create', {
      directory: '/repo',
      prompt: 'say hi',
      model: 'openai/gpt-4o',
    })).resolves.toEqual(expect.objectContaining({
      sessionId: 'ses_1',
      promptDispatched: true,
      model: { providerID: 'openai', modelID: 'gpt-4o' },
    }));
    expect(host.setSessionModel).toHaveBeenCalledWith('ses_1', 'openai/gpt-4o');
    expect(host.promptAsync).toHaveBeenCalledWith('ses_1', {
      parts: [{ type: 'text', text: 'say hi' }],
      model: 'openai/gpt-4o',
    });
    expect(host.setSessionModel.mock.invocationCallOrder[0]).toBeLessThan(host.promptAsync.mock.invocationCallOrder[0]);
  });

  it('rejects an unknown model before createSession', async () => {
    const { service, host } = createPiService();
    await expect(service.execute('session.create', {
      directory: '/repo',
      model: 'missing/nope',
    })).rejects.toThrow("Unknown model 'missing/nope'");
    expect(host.createSession).not.toHaveBeenCalled();
  });

  it('creates a worktree session and does not leave a session when bootstrap fails', async () => {
    const createWorktree = vi.fn(async () => ({ path: '/repo/worktrees/side', name: 'side' }));
    const { service, host } = createPiService({
      createWorktree,
      getWorktreeBootstrapStatus: vi.fn(async () => ({
        status: 'failed',
        phase: 'directory-created',
        error: 'branch already exists',
      })),
    });
    await expect(service.execute('session.create', {
      directory: '/repo',
      worktree: 'side',
    })).rejects.toThrow('Worktree bootstrap failed: branch already exists');
    expect(createWorktree).toHaveBeenCalledWith('/repo', expect.objectContaining({ name: 'side' }));
    expect(host.createSession).not.toHaveBeenCalled();

    const ready = createPiService({ createWorktree });
    await ready.service.execute('session.create', { directory: '/repo', worktree: 'side', title: 'wt' });
    expect(ready.host.createSession).toHaveBeenCalledWith({ directory: '/repo/worktrees/side', title: 'wt' });
  });

  it('sends a prompt through host.promptAsync and resolves directory from the host list', async () => {
    const { service, host } = createPiService({
      host: {
        getSession: vi.fn(() => ({ id: 'ses_target', directory: '/repo/worktrees/target' })),
      },
    });
    await service.execute('session.send', { sessionId: 'ses_target', prompt: 'Continue' }, '/repo');
    expect(host.promptAsync).toHaveBeenCalledWith('ses_target', expect.objectContaining({
      parts: [{ type: 'text', text: 'Continue' }],
    }));
    expect(host.createSession).not.toHaveBeenCalled();
  });

  it('rejects session.send without a prompt before any host call', async () => {
    const { service, host } = createPiService();
    await expect(service.execute('session.send', { sessionId: 'ses_1', directory: '/repo' }))
      .rejects.toThrow('prompt is required');
    expect(host.promptAsync).not.toHaveBeenCalled();
    expect(host.createSession).not.toHaveBeenCalled();
  });

  it('forks at messageId then prompts the new session', async () => {
    const { service, host } = createPiService();
    await service.execute('session.fork', {
      sessionId: 'ses_source',
      directory: '/repo',
      messageId: 'msg_a',
      prompt: 'continue from here',
    });
    expect(host.forkSession).toHaveBeenCalledWith('ses_source', 'msg_a');
    expect(host.promptAsync).toHaveBeenCalledWith('ses_fork', expect.objectContaining({
      parts: [{ type: 'text', text: 'continue from here' }],
    }));
  });

  it('lists sessions with archived excluded and default limit 10', async () => {
    const infos = Array.from({ length: 12 }, (_, index) => ({
      id: `ses_${index}`,
      directory: '/repo',
      time: index === 0 ? { archived: 100 } : {},
    }));
    const { service, host } = createPiService({
      host: { listSessionInfos: vi.fn(async () => infos) },
    });
    await expect(service.execute('session.list')).resolves.toEqual({
      sessions: infos.filter((item) => !item.time.archived).slice(0, 10),
      limit: 10,
      directory: null,
      archived: 'excluded',
    });
    await expect(service.execute('session.list', { limit: 0 })).rejects.toThrow('limit must be a positive integer');
    expect(host.listSessionInfos).toHaveBeenCalledTimes(1);
  });

  it('marks only the failed directory unknown when listing with status', async () => {
    const { service, host } = createPiService({
      host: {
        listSessionInfos: vi.fn(async () => [
          { id: 'ses_active', directory: '/repo', time: {} },
          { id: 'ses_other', directory: '/other', time: {} },
        ]),
        getStatus: vi.fn((directory) => {
          if (directory === '/other') throw new Error('unavailable');
          return { ses_active: { type: 'busy' } };
        }),
      },
    });
    await expect(service.execute('session.list', { withStatus: true })).resolves.toEqual({
      sessions: [
        { id: 'ses_active', directory: '/repo', time: {}, status: { type: 'busy' } },
        { id: 'ses_other', directory: '/other', time: {}, status: { type: 'unknown' } },
      ],
      limit: 10,
      directory: null,
      archived: 'excluded',
    });
    expect(host.getStatus).toHaveBeenCalled();
  });

  it('projects only ordered text parts from host messages', async () => {
    const { service } = createPiService({
      host: { getMessages: vi.fn(() => MESSAGE_FIXTURE) },
    });
    await expect(service.execute('session.messages', {
      sessionId: 'ses_1',
      directory: '/repo',
      role: 'all',
      all: true,
    })).resolves.toEqual({
      sessionId: 'ses_1',
      directory: '/repo',
      role: 'all',
      sessionStatus: { type: 'idle' },
      messages: [
        { id: 'msg_user', role: 'user', createdAt: 10, completedAt: null, model: null, text: 'Question' },
        { id: 'msg_assistant', role: 'assistant', createdAt: 20, completedAt: 30, model: 'openai/gpt-5.4-mini', text: 'First answer' },
      ],
    });
  });

  it('rejects timeout without wait before createSession', async () => {
    const { service, host } = createPiService();
    await expect(service.execute('session.create', { directory: '/repo', timeout: 30 }))
      .rejects.toThrow('timeout requires wait');
    expect(host.createSession).not.toHaveBeenCalled();
  });

  it('waits past initial idle until a new completed assistant appears', async () => {
    let timestamp = 1000;
    let statusCalls = 0;
    const { service, host } = createPiService({
      now: () => timestamp,
      sleep: async (duration) => { timestamp += duration; },
      host: {
        promptAsync: vi.fn(async () => ({})),
        getStatus: vi.fn(() => {
          statusCalls += 1;
          return {};
        }),
        getMessages: vi.fn()
          .mockReturnValueOnce([])
          .mockReturnValueOnce([
            { info: { id: 'msg_user', role: 'user', time: { created: 1100 } }, parts: [{ type: 'text', text: 'work' }] },
          ])
          .mockReturnValueOnce([
            { info: { id: 'msg_old', role: 'assistant', time: { created: 800, completed: 900 } }, parts: [{ type: 'text', text: 'old' }] },
          ])
          .mockReturnValueOnce([
            { info: { id: 'msg_new', role: 'assistant', time: { created: 1400, completed: 1500 } }, parts: [{ type: 'text', text: 'done' }] },
          ])
          .mockReturnValue([
            { info: { id: 'msg_new', role: 'assistant', time: { created: 1400, completed: 1500 } }, parts: [{ type: 'text', text: 'done' }] },
          ]),
      },
    });
    await expect(service.execute('session.create', {
      directory: '/repo',
      prompt: 'work',
      wait: true,
      lastAssistant: true,
      timeout: 2,
    })).resolves.toEqual(expect.objectContaining({
      sessionStatus: { type: 'idle' },
      lastAssistantMessage: expect.objectContaining({ id: 'msg_new', text: 'done' }),
    }));
    expect(statusCalls).toBeGreaterThan(0);
    expect(host.createSession).toHaveBeenCalled();
  });

  it('rejects lastAssistant without wait before createSession', async () => {
    const { service, host } = createPiService();
    await expect(service.execute('session.create', { directory: '/repo', lastAssistant: true }))
      .rejects.toThrow('lastAssistant requires wait');
    expect(host.createSession).not.toHaveBeenCalled();
  });

  it('lists Pi model preferences from host defaults, not leftover OpenCode settings', async () => {
    const { service, host } = createPiService();
    await expect(service.execute('models.list')).resolves.toEqual({
      defaultModel: 'example-provider/example-model',
      defaultVariant: 'medium',
      defaultAgent: null,
      favoriteModels: ['example-provider/example-model'],
      recentModels: [],
    });
    expect(host.getDefaults).toHaveBeenCalled();
  });

  it('still lists configured projects on Pi', async () => {
    const { service } = createPiService();
    await expect(service.execute('projects.list')).resolves.toEqual({
      projects: [{ id: 'project-1', path: '/repo', label: 'Repo' }],
    });
  });
});

describe('Pi mapping for leftover OpenCode inputs', () => {
  it('rejects leftover OpenCode agent names before create or worktree', async () => {
    const createWorktree = vi.fn();
    const { service, host } = createPiService({ createWorktree });
    await expect(service.execute('session.create', {
      directory: '/repo',
      agent: 'build',
      worktree: 'side',
    })).rejects.toThrow("Unknown agent 'build'");
    expect(host.createSession).not.toHaveBeenCalled();
    expect(createWorktree).not.toHaveBeenCalled();
  });

  it('omits agent and does not invent an OpenCode agent', async () => {
    const { service, host } = createPiService();
    await service.execute('session.create', { directory: '/repo', prompt: 'hi' });
    expect(host.promptAsync).toHaveBeenCalledWith('ses_1', {
      parts: [{ type: 'text', text: 'hi' }],
      model: 'example-provider/example-model',
    });
    expect(host.promptAsync.mock.calls[0][1].agent).toBeUndefined();
  });

  it('rejects goal when the Feature Plugins slot is off', async () => {
    const { service, host } = createPiService();
    await expect(service.execute('session.create', {
      directory: '/repo',
      prompt: 'ship it',
      goal: true,
    })).rejects.toThrow('Goal must be installed and enabled in Feature Plugins');
    expect(host.createSession).not.toHaveBeenCalled();
    expect(host.runCommand).not.toHaveBeenCalled();
  });

  it('starts Feature Plugins Goal through runCommand, not leftover Session Goal', async () => {
    const { service, host } = createPiService({
      host: {
        getFeaturePlugins: vi.fn(() => ({
          slots: { goal: { installed: true, enabled: true, command: 'goal' } },
        })),
      },
    });
    await expect(service.execute('session.create', {
      directory: '/repo',
      prompt: 'implement snake',
      goal: true,
    })).resolves.toEqual(expect.objectContaining({
      promptDispatched: true,
      dispatchedAsCommand: true,
      goalEnabled: true,
    }));
    expect(host.runCommand).toHaveBeenCalledWith('ses_1', {
      command: 'goal',
      arguments: 'implement snake',
    });
    expect(host.promptAsync).not.toHaveBeenCalled();
  });

  it('rejects goalTokenBudget without goal', async () => {
    const { service, host } = createPiService();
    await expect(service.execute('session.create', {
      directory: '/repo',
      prompt: 'hi',
      goalTokenBudget: 5000,
    })).rejects.toThrow('goalTokenBudget requires goal');
    expect(host.createSession).not.toHaveBeenCalled();
  });

  it('applies a Pi thinking variant and rejects an unknown one before create', async () => {
    const { service, host } = createPiService();
    await expect(service.execute('session.create', {
      directory: '/repo',
      variant: 'not-a-level',
    })).rejects.toThrow("Unknown variant 'not-a-level'");
    expect(host.createSession).not.toHaveBeenCalled();

    await service.execute('session.create', { directory: '/repo', prompt: 'hi', variant: 'high' });
    expect(host.setSessionThinking).toHaveBeenCalledWith('ses_1', 'high');
  });
});

describe('Pi schedule actions stay on the scheduled-task service', () => {
  it('maps schedule.create through scheduledTaskService.upsert', async () => {
    const { service, scheduledTaskService, createClient } = createPiService();
    await expect(service.execute('schedule.create', {
      directory: '/repo',
      name: 'Daily',
      prompt: 'Run checks',
      model: 'provider/model',
      daily: '09:00',
    })).resolves.toEqual({ task: { id: 'task-1' }, created: true });
    expect(scheduledTaskService.upsert).toHaveBeenCalledWith('project-1', expect.objectContaining({
      name: 'Daily',
      schedule: { kind: 'daily', times: ['09:00'] },
    }));
    expect(createClient).not.toHaveBeenCalled();
  });

  it('runs a scheduled task without instantiating createOpencodeClient', async () => {
    const { service, scheduledTaskService, createClient } = createPiService();
    await expect(service.execute('schedule.run', { taskId: 'task-1' }, '/repo')).resolves.toEqual({
      ok: true,
      sessionID: 'ses_task',
    });
    expect(scheduledTaskService.run).toHaveBeenCalledWith('project-1', 'task-1');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('requires disabled for schedule.toggle before setEnabled', async () => {
    const { service, scheduledTaskService } = createPiService();
    await expect(service.execute('schedule.toggle', { taskId: 'task-1' }, '/repo'))
      .rejects.toThrow('disabled is required for schedule.toggle');
    expect(scheduledTaskService.setEnabled).not.toHaveBeenCalled();
  });

  it('requires taskId before resolveProjectID', async () => {
    const { service, scheduledTaskService } = createPiService();
    await expect(service.execute('schedule.run', {}, '/repo')).rejects.toThrow('taskId is required');
    expect(scheduledTaskService.resolveProjectID).not.toHaveBeenCalled();
  });

  it('does not combine an explicit schedule project with the tool context directory', async () => {
    const { service, scheduledTaskService } = createPiService();
    await service.execute('schedule.list', { projectId: ' project-1 ' }, '/current-session');
    expect(scheduledTaskService.resolveProjectID).toHaveBeenCalledWith({
      projectId: 'project-1',
      directory: undefined,
    });
  });
});
