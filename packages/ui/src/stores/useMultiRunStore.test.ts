import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';

const upsertedSessions: Session[] = [];
const registeredDirectories: Array<{ sessionID: string; directory: string }> = [];
const ensureChildCalls: Array<{ directory: string; bootstrap?: boolean }> = [];
const worktreeMetadataCalls: Array<{ sessionId: string; path: string }> = [];
const worktreeCreateCalls: Array<{ project: { id?: string; path: string }; args: Record<string, unknown>; options: unknown }> = [];
const worktreeBootstrapWaitCalls: string[] = [];
const operationOrder: string[] = [];
const modelPatchCalls: Array<{ sessionId: string; model: string }> = [];
const routeMessageCalls: Array<Record<string, unknown>> = [];
let isGitRepository = false;
let waitForWorktreeSetup = false;
let createdSessionVersion: string | undefined;
let sessionSeq = 0;
const createWorktreeWithDefaultsMock = mock((project: { id?: string; path: string }, args: Record<string, unknown>, options: unknown) => {
  worktreeCreateCalls.push({ project, args, options });
  return Promise.resolve({
    source: 'sdk',
    name: 'fix-thing',
    path: '/repo-worktrees/fix-thing',
    projectDirectory: '/repo',
    branch: 'fix-thing',
    label: 'fix-thing',
    worktreeRoot: '/repo-worktrees/fix-thing',
    worktreeStatus: 'pending',
    headState: 'branch',
    worktreeSource: 'created-for-session',
  });
});
const childState = {
  session: [] as Session[],
  sessionTotal: 0,
  limit: 5,
};
let currentDirectory = '/repo';

mock.module('@/sync/session-ui-store', () => ({
  routeMessage: mock((params: Record<string, unknown>) => {
    routeMessageCalls.push(params);
    return Promise.resolve();
  }),
  useSessionUIStore: {
    getState: () => ({
      markSessionAsOpenChamberCreated: mock(() => undefined),
      setWorktreeMetadata: (sessionId: string, metadata: { path: string }) => {
        worktreeMetadataCalls.push({ sessionId, path: metadata.path });
      },
    }),
  },
}));

mock.module('@/lib/opencode/client', () => ({
  opencodeClient: {
    withDirectory: async (directory: string, fn: () => Promise<Session>) => {
      const previous = currentDirectory;
      currentDirectory = directory;
      try {
        return await fn();
      } finally {
        currentDirectory = previous;
      }
    },
    createSession: async (params?: { title?: string }): Promise<Session> => {
      sessionSeq += 1;
      operationOrder.push(`createSession:${currentDirectory}`);
      return {
        id: `ses_multirun_${sessionSeq}`,
        title: params?.title ?? '',
        directory: currentDirectory,
        time: { created: 1, updated: 1 },
        ...(createdSessionVersion ? { version: createdSessionVersion } : {}),
      } as Session;
    },
  },
}));

mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: mock(async (path: string, init?: { method?: string; body?: string }) => {
    const match = path.match(/^\/api\/session\/([^/]+)\/model$/);
    if (match && init?.method === 'PATCH') {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) as { model?: string } : {};
      modelPatchCalls.push({ sessionId: decodeURIComponent(match[1]), model: body.model ?? '' });
      operationOrder.push(`setModel:${decodeURIComponent(match[1])}:${body.model ?? ''}`);
      return new Response(JSON.stringify({ applied: true, model: body.model }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }),
}));

mock.module('@/lib/gitApi', () => ({
  checkIsGitRepository: mock(() => Promise.resolve(isGitRepository)),
}));

mock.module('@/lib/worktrees/worktreeCreate', () => ({
  createWorktreeWithDefaults: createWorktreeWithDefaultsMock,
  resolveRootTrackingRemote: mock(() => Promise.resolve(null)),
}));

mock.module('@/lib/worktrees/worktreeBootstrap', () => ({
  waitForWorktreeBootstrap: (directory: string) => {
    worktreeBootstrapWaitCalls.push(directory);
    operationOrder.push(`wait:${directory}`);
    return Promise.resolve();
  },
}));

mock.module('@/lib/worktrees/worktreeStatus', () => ({
  getRootBranch: mock(() => Promise.resolve('main')),
}));

mock.module('@/lib/openchamberConfig', () => ({
  getWorktreeSetupWaitEnabled: mock(() => Promise.resolve(waitForWorktreeSetup)),
  saveWorktreeSetupCommands: mock(() => Promise.resolve()),
}));

mock.module('./useDirectoryStore', () => ({
  useDirectoryStore: {
    getState: () => ({ currentDirectory: '/repo' }),
  },
}));

mock.module('./useProjectsStore', () => ({
  useProjectsStore: {
    getState: () => ({
      activeProjectId: 'project-1',
      projects: [{ id: 'project-1', path: '/repo' }],
    }),
  },
}));

mock.module('./useSnippetsStore', () => ({
  useSnippetsStore: {
    getState: () => ({
      expandText: (value: string) => Promise.resolve(value),
    }),
  },
}));

mock.module('./useGlobalSessionsStore', () => ({
  useGlobalSessionsStore: {
    getState: () => ({
      upsertSession: (session: Session) => {
        upsertedSessions.push(session);
      },
    }),
  },
}));

mock.module('@/sync/sync-refs', () => ({
  getSyncSessionDirectory: () => null,
  registerSessionDirectory: (sessionID: string, directory: string) => {
    registeredDirectories.push({ sessionID, directory });
  },
  getSyncChildStores: () => ({
    ensureChild: (directory: string, options?: { bootstrap?: boolean }) => {
      ensureChildCalls.push({ directory, bootstrap: options?.bootstrap });
      return {
        setState: (updater: typeof childState | ((state: typeof childState) => Partial<typeof childState> | typeof childState)) => {
          const patch = typeof updater === 'function' ? updater(childState) : updater;
          if (patch !== childState) {
            Object.assign(childState, patch);
          }
        },
      };
    },
  }),
}));

const { useMultiRunStore } = await import('./useMultiRunStore');

describe('useMultiRunStore', () => {
  beforeEach(() => {
    upsertedSessions.length = 0;
    registeredDirectories.length = 0;
    ensureChildCalls.length = 0;
    worktreeMetadataCalls.length = 0;
    worktreeCreateCalls.length = 0;
    worktreeBootstrapWaitCalls.length = 0;
    operationOrder.length = 0;
    modelPatchCalls.length = 0;
    routeMessageCalls.length = 0;
    isGitRepository = false;
    waitForWorktreeSetup = false;
    createdSessionVersion = undefined;
    sessionSeq = 0;
    childState.session = [];
    childState.sessionTotal = 0;
    childState.limit = 5;
    currentDirectory = '/repo';
    useMultiRunStore.setState({ isLoading: false, error: null });
  });

  test('registers created sessions without waiting for a sidebar refresh', async () => {
    const result = await useMultiRunStore.getState().createMultiRun({
      name: 'Fix thing',
      isolateRuns: false,
      groups: [{
        prompt: 'Fix it',
        models: [{ providerID: 'anthropic', modelID: 'claude-sonnet-4-5' }],
      }],
    });

    expect(result?.sessionIds).toEqual(['ses_multirun_1']);
    expect(upsertedSessions.map((session) => session.id)).toEqual(['ses_multirun_1']);
    expect(registeredDirectories).toEqual([{ sessionID: 'ses_multirun_1', directory: '/repo' }]);
    expect(ensureChildCalls).toEqual([{ directory: '/repo', bootstrap: false }]);
    expect(childState.session.map((session) => session.id)).toEqual(['ses_multirun_1']);
    expect(modelPatchCalls).toEqual([]);
    expect(routeMessageCalls.map((call) => ({
      sessionId: call.sessionId,
      directory: call.directory,
      content: call.content,
      providerID: call.providerID,
      modelID: call.modelID,
    }))).toEqual([{
      sessionId: 'ses_multirun_1',
      directory: '/repo',
      content: 'Fix it',
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4-5',
    }]);
  });

  test('uses fast background worktree creation for isolated runs', async () => {
    isGitRepository = true;

    const result = await useMultiRunStore.getState().createMultiRun({
      name: 'Fix thing',
      isolateRuns: true,
      groups: [{
        prompt: 'Fix it',
        models: [{ providerID: 'anthropic', modelID: 'claude-sonnet-4-5' }],
      }],
    });

    expect(result?.sessionIds).toEqual(['ses_multirun_1']);
    expect(worktreeCreateCalls.length).toBe(1);
    expect(worktreeCreateCalls[0]?.project).toEqual({ id: 'project-1', path: '/repo' });
    expect(worktreeCreateCalls[0]?.args.returnAfterDirectoryCreated).toBe(true);
    expect(worktreeCreateCalls[0]?.options).toEqual({ resolvedRootTrackingRemote: null });
    expect(worktreeBootstrapWaitCalls).toEqual([]);
    expect(operationOrder).toEqual(['createSession:/repo-worktrees/fix-thing']);
    expect(registeredDirectories).toEqual([{ sessionID: 'ses_multirun_1', directory: '/repo-worktrees/fix-thing' }]);
    expect(worktreeMetadataCalls).toEqual([{ sessionId: 'ses_multirun_1', path: '/repo-worktrees/fix-thing' }]);
  });

  test('waits for isolated worktree bootstrap when setup wait is enabled', async () => {
    isGitRepository = true;
    waitForWorktreeSetup = true;

    const result = await useMultiRunStore.getState().createMultiRun({
      name: 'Fix thing',
      isolateRuns: true,
      groups: [{
        prompt: 'Fix it',
        models: [{ providerID: 'anthropic', modelID: 'claude-sonnet-4-5' }],
      }],
    });

    expect(result?.sessionIds).toEqual(['ses_multirun_1']);
    expect(worktreeBootstrapWaitCalls).toEqual(['/repo-worktrees/fix-thing']);
    expect(operationOrder).toEqual([
      'wait:/repo-worktrees/fix-thing',
      'createSession:/repo-worktrees/fix-thing',
    ]);
  });

  test('Pi create/start path applies each live model and sends the launcher prompt', async () => {
    createdSessionVersion = 'pi';

    const result = await useMultiRunStore.getState().createMultiRun({
      name: 'Compare',
      isolateRuns: false,
      groups: [{
        prompt: 'Compare these approaches',
        models: [
          { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
          { providerID: 'openai', modelID: 'gpt-5' },
        ],
      }],
    });

    expect(result?.sessionIds).toEqual(['ses_multirun_1', 'ses_multirun_2']);
    expect(modelPatchCalls).toEqual([
      { sessionId: 'ses_multirun_1', model: 'anthropic/claude-sonnet-4-5' },
      { sessionId: 'ses_multirun_2', model: 'openai/gpt-5' },
    ]);
    expect(routeMessageCalls.map((call) => ({
      sessionId: call.sessionId,
      content: call.content,
      providerID: call.providerID,
      modelID: call.modelID,
    }))).toEqual([
      {
        sessionId: 'ses_multirun_1',
        content: 'Compare these approaches',
        providerID: 'anthropic',
        modelID: 'claude-sonnet-4-5',
      },
      {
        sessionId: 'ses_multirun_2',
        content: 'Compare these approaches',
        providerID: 'openai',
        modelID: 'gpt-5',
      },
    ]);
    expect(operationOrder).toEqual([
      'createSession:/repo',
      'createSession:/repo',
      'setModel:ses_multirun_1:anthropic/claude-sonnet-4-5',
      'setModel:ses_multirun_2:openai/gpt-5',
    ]);
  });
});
