import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPiHost } from './pi-host.js';
import { resolvePiAgentDir } from './pi-resources.js';
import {
  NODE_KERNEL_PROTOCOL,
  restoreKernelError,
} from './node-kernel-protocol.js';
import {
  childPathEnvForNode,
  createMissingNodeError,
  createSdkUnavailableError,
  describeNodeKernelFailure,
  isSdkHelloReady,
  resolvePiNodeRuntime,
  toNodeReadablePath,
} from './node-runtime.js';

const CHILD_SCRIPT = fileURLToPath(new URL('./node-kernel-child.js', import.meta.url));

const KERNEL_RELOAD_INTERRUPTED_KIND = 'opencode-restart-interrupted';
const PI_CHROME_CDP_PROCESS_PATTERN = 'pi-chrome-cdp-';

const parseProcessIds = (text) => (
  String(text || '')
    .split(/[\s,]+/)
    .map((value) => Number.parseInt(value, 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
);

/**
 * Agent Chrome windows launched by pi-chrome detach from the kernel child.
 * Quit must reap them or they stay on the desktop with PPID 1.
 */
export const reapPiChromeCdpProcesses = ({
  platform = process.platform,
  spawnSyncImpl = spawnSync,
  killImpl = process.kill.bind(process),
  selfPid = process.pid,
} = {}) => {
  if (platform === 'win32') return [];
  let listing;
  try {
    listing = spawnSyncImpl('pgrep', ['-f', PI_CHROME_CDP_PROCESS_PATTERN], {
      encoding: 'utf8',
    });
  } catch {
    return [];
  }
  const pids = parseProcessIds(listing?.stdout).filter((pid) => pid !== selfPid);
  for (const pid of pids) {
    try {
      killImpl(pid, 'SIGTERM');
    } catch {
    }
    try {
      killImpl(pid, 'SIGKILL');
    } catch {
    }
  }
  return pids;
};

export const resolveNodeKernelChildScript = ({
  childScript,
} = {}) => {
  if (typeof childScript === 'string' && childScript.trim()) {
    return toNodeReadablePath(childScript.trim());
  }
  return toNodeReadablePath(CHILD_SCRIPT);
};

const asCustomToolList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((tool) => tool && typeof tool.name === 'string');
  if (typeof value === 'object') {
    return Object.values(value).filter((tool) => tool && typeof tool.name === 'string');
  }
  return [];
};

const asTrimmedString = (value) => (typeof value === 'string' && value.trim() ? value.trim() : '');

const readManagerPath = (sessionManager, method) => {
  if (!sessionManager || typeof sessionManager[method] !== 'function') return '';
  try {
    return asTrimmedString(sessionManager[method]());
  } catch {
    return '';
  }
};

/**
 * IPC cannot carry a live SessionManager. Send the disk file / id so the
 * child opens that jsonl instead of SessionManager.create (a new Untitled).
 */
// Child createPiHost still translates for its own record. The parent host
// already turns raw `session-event` into the product OpenCode stream after
// promptAsync inserts the user bubble. Forwarding those translated events
// again would show one send as two (or three) turns and apply text deltas twice.
const PARENT_OWNED_CHILD_HOST_EVENT_TYPES = new Set([
  'message.updated',
  'message.part.updated',
  'message.part.delta',
  'message.removed',
  'session.status',
  'session.idle',
]);

export const shouldForwardNodeKernelHostEvent = (event) => {
  if (!event || typeof event !== 'object') return false;
  return !PARENT_OWNED_CHILD_HOST_EVENT_TYPES.has(event.type);
};

export const serializeNodeKernelCreateSessionInput = (input = {}) => {
  const cwd = asTrimmedString(input.cwd || input.directory);
  const sessionFile = asTrimmedString(input.sessionFile)
    || readManagerPath(input.sessionManager, 'getSessionFile');
  const sessionID = asTrimmedString(input.sessionID)
    || readManagerPath(input.sessionManager, 'getSessionId');
  const title = asTrimmedString(input.title);
  const rawModel = input.model && typeof input.model === 'object' ? input.model : null;
  const modelId = asTrimmedString(rawModel?.id || rawModel?.modelId || rawModel?.modelID);
  const modelProvider = asTrimmedString(rawModel?.provider || rawModel?.providerID);
  return {
    ...(cwd ? { cwd, directory: cwd } : {}),
    ...(sessionFile ? { sessionFile } : {}),
    ...(sessionID ? { sessionID } : {}),
    ...(title ? { title } : {}),
    ...(modelId ? { model: { id: modelId, ...(modelProvider ? { provider: modelProvider } : {}) } } : {}),
  };
};

const createRemotePiSession = (client, snapshot) => {
  const state = { ...snapshot };
  const applySnapshot = (next) => {
    if (!next || typeof next !== 'object') return;
    Object.assign(state, next);
  };
  const call = async (name, args = [], target) => {
    const reply = await client.call('session.method', {
      sessionId: state.sessionId,
      name,
      args,
      target,
    });
    applySnapshot(reply?.snapshot);
    return reply?.result;
  };
  const session = {
    sessionId: state.sessionId,
    get sessionFile() {
      return state.sessionFile;
    },
    get isStreaming() {
      return Boolean(state.isStreaming);
    },
    get isCompacting() {
      return Boolean(state.isCompacting);
    },
    get thinkingLevel() {
      return state.thinkingLevel;
    },
    set thinkingLevel(value) {
      state.thinkingLevel = value;
    },
    get currentModel() {
      return state.currentModel;
    },
    set currentModel(value) {
      state.currentModel = value;
    },
    subscribe(listener) {
      return client.subscribeSession(state.sessionId, listener);
    },
    getCommands() {
      return Array.isArray(state.commands) ? state.commands : [];
    },
    getToolDefinition(name) {
      return (state.toolNames || []).includes(name) ? { name } : undefined;
    },
    setCustomTools(next) {
      // Parent injects tool objects after create. The child already attached
      // executable `pichamber` / `pichamber_web` wrappers; do not replace them
      // with name-only stubs over IPC.
      state.toolNames = asCustomToolList(next).map((tool) => tool.name);
    },
    getPlanModeState() {
      return state.planModeState;
    },
    setPlanModeState(next) {
      state.planModeState = next;
      return call('setPlanModeState', [next]);
    },
    sessionManager: {
      getEntries() {
        return Array.isArray(state.entries) ? state.entries : [];
      },
      getBranch() {
        return Array.isArray(state.entries) ? state.entries : [];
      },
      appendCustomEntry(customType, data) {
        return call('appendCustomEntry', [customType, data], 'sessionManager');
      },
      appendEntry(entry) {
        return call('appendEntry', [entry], 'sessionManager');
      },
    },
    async prompt(text, options) {
      state.isStreaming = true;
      try {
        return await call('prompt', [text, options]);
      } finally {
        state.isStreaming = false;
      }
    },
    steer(text, images) {
      return call('steer', [text, images]);
    },
    followUp(text, images) {
      return call('followUp', [text, images]);
    },
    async abort() {
      state.isStreaming = false;
      return call('abort');
    },
    getAvailableThinkingLevels() {
      return Array.isArray(state.availableThinkingLevels) ? state.availableThinkingLevels : [];
    },
    setThinkingLevel(level) {
      state.thinkingLevel = level;
      return call('setThinkingLevel', [level]);
    },
    setModel(model) {
      state.currentModel = model;
      return call('setModel', [model]);
    },
    getContextUsage() {
      return state.contextUsage;
    },
    compact(instructions) {
      return call('compact', [instructions]);
    },
    reload() {
      return call('reload');
    },
    dispose() {
      client.forgetSession(state.sessionId);
      if (!client.isConnected()) return undefined;
      return call('dispose').catch(() => undefined);
    },
    bindExtensions(bindings = {}) {
      session.extensionBindings = bindings;
      return call('bindExtensions', [{ mode: bindings.mode || 'rpc' }]);
    },
  };
  client.rememberSession(state.sessionId, session, applySnapshot);
  return session;
};

export const createNodeKernelClient = ({
  env = process.env,
  versions = process.versions,
  execPath = process.execPath,
  platform = process.platform,
  resourcesPath,
  nodeBinary,
  childScript,
  spawnImpl = spawn,
  home = os.homedir(),
  defaultDirectory = process.cwd(),
  mock = false,
  loadUserNpmExtensions = false,
  failSdkLoad,
  getCustomTools,
  onHostEvent,
  onChildExit,
  resolveNodeRuntime = resolvePiNodeRuntime,
} = {}) => {
  const runtime = resolveNodeRuntime({
    env,
    versions,
    execPath,
    platform,
    resourcesPath,
    nodeBinary,
  });
  const script = resolveNodeKernelChildScript({ childScript });
  let child = null;
  let started = null;
  let callId = 0;
  const pending = new Map();
  const sessionListeners = new Map();
  const sessionSnapshots = new Map();
  let hello = null;
  let exitError = null;
  const liveSessionIds = new Set();

  const describe = () => {
    const snapshot = {
      ...runtime,
      childScript: script,
      hello,
      pid: child?.pid || null,
    };
    const failure = describeNodeKernelFailure(snapshot);
    if (!failure) return snapshot;
    return {
      ...snapshot,
      code: failure.code,
      message: failure.message,
      recovery: failure.recovery,
    };
  };

  const rejectAll = (error) => {
    for (const item of pending.values()) {
      item.reject(error);
    }
    pending.clear();
  };

  const handleMessage = (message) => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'ready') {
      hello = message.hello;
      return;
    }
    if (message.type === 'hello' && !hello) {
      hello = { pid: message.pid, child: message.child };
      return;
    }
    if (message.type === 'result') {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      if (message.ok) item.resolve(message.value);
      else item.reject(restoreKernelError(message.error));
      return;
    }
    if (message.type === 'session-event') {
      const listeners = sessionListeners.get(message.sessionId);
      if (listeners) {
        for (const listener of Array.from(listeners)) {
          try {
            listener(message.event);
          } catch {
          }
        }
      }
      return;
    }
    if (message.type === 'host-event') {
      if (typeof onHostEvent === 'function' && shouldForwardNodeKernelHostEvent(message.event)) {
        onHostEvent(message.directory, message.event);
      }
      return;
    }
    if (message.type === 'parent-call') {
      void (async () => {
        try {
          const value = await handleParentCall(message.method, message.params);
          child?.send?.({ type: 'parent-result', id: message.id, ok: true, value });
        } catch (error) {
          child?.send?.({
            type: 'parent-result',
            id: message.id,
            ok: false,
            error: {
              message: error?.message || String(error),
              status: error?.status,
              code: error?.code,
            },
          });
        }
      })();
    }
  };

  const handleParentCall = async (method, params = {}) => {
    if (method === 'customTools.list') {
      const tools = asCustomToolList(typeof getCustomTools === 'function' ? await getCustomTools() : []);
      return {
        control: tools.some((tool) => tool.name === 'pichamber'),
        web: tools.some((tool) => tool.name === 'pichamber_web'),
      };
    }
    if (method === 'customTools.execute') {
      const tools = asCustomToolList(typeof getCustomTools === 'function' ? await getCustomTools() : []);
      const tool = tools.find((item) => item.name === params.name);
      if (!tool || typeof tool.execute !== 'function') {
        throw new Error(`Custom tool is unavailable: ${params.name || 'unknown'}`);
      }
      return tool.execute(null, { ...(params.params || {}), action: params.action }, undefined, undefined, {
        cwd: params.cwd,
      });
    }
    if (method.startsWith('ui.')) {
      const session = sessionSnapshots.get(params.sessionId)?.session;
      const ui = session?.extensionBindings?.uiContext;
      if (method === 'ui.notify') {
        return ui?.notify?.(params.message, params.level);
      }
      if (method === 'ui.select') return ui?.select?.(params.title, params.options, params.opts);
      if (method === 'ui.confirm') return ui?.confirm?.(params.title, params.message);
      if (method === 'ui.input') return ui?.input?.(params.title, params.opts);
      if (method === 'ui.editor') return ui?.editor?.(params.title, params.opts);
    }
    throw new Error(`Unknown parent kernel method: ${method}`);
  };

  const call = (method, params) => {
    if (!child || !child.connected) {
      return Promise.reject(exitError || createMissingNodeError(runtime));
    }
    const id = `call-${++callId}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.send({ type: 'call', id, method, params });
    });
  };

  const spawnChild = () => {
    if (!runtime.ok) {
      throw createMissingNodeError(runtime);
    }
    exitError = null;
    const nextEnv = {
      ...env,
      PATH: childPathEnvForNode(runtime.command, env),
    };
    delete nextEnv.ELECTRON_RUN_AS_NODE;
    const spawned = spawnImpl(runtime.command, [script], {
      env: nextEnv,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    });
    spawned.on('message', handleMessage);
    spawned.on('error', (error) => {
      exitError = error;
      rejectAll(error);
    });
    spawned.on('exit', (code, signal) => {
      const error = new Error(`Pi node kernel exited (${signal || code || 'unknown'})`);
      error.code = 'PI_NODE_KERNEL_EXIT';
      error.status = 503;
      exitError = error;
      rejectAll(error);
      child = null;
      started = null;
      if (typeof onChildExit === 'function') {
        onChildExit({
          code,
          signal,
          sessionIds: Array.from(liveSessionIds),
          error,
        });
      }
    });
    if (spawned.stderr) {
      spawned.stderr.on('data', (chunk) => {
        const text = String(chunk || '').trim();
        if (text) console.warn(`[pi-node-kernel] ${text}`);
      });
    }
    child = spawned;
    spawned.send({
      type: 'boot',
      boot: {
        protocol: NODE_KERNEL_PROTOCOL,
        home,
        defaultDirectory,
        mock,
        loadUserNpmExtensions,
        failSdkLoad,
        agentDir: resolvePiAgentDir(home),
      },
    });
    return spawned;
  };

  const ensureStarted = async () => {
    if (!runtime.ok) {
      throw createMissingNodeError(runtime);
    }
    if (started) return started;
    started = new Promise((resolve, reject) => {
      try {
        spawnChild();
      } catch (error) {
        started = null;
        reject(error);
        return;
      }
      const timer = setTimeout(() => {
        reject(new Error('Pi node kernel did not become ready'));
      }, 15000);
      const onReady = (message) => {
        if (message?.type === 'ready') {
          clearTimeout(timer);
          child?.off?.('message', onReady);
          resolve(hello || message.hello || message);
        }
      };
      child.on('message', onReady);
      child.once('error', (error) => {
        clearTimeout(timer);
        started = null;
        reject(error);
      });
    });
    return started;
  };

  const api = {
    runtime,
    describe,
    call,
    ensureStarted,
    subscribeSession(sessionId, listener) {
      const set = sessionListeners.get(sessionId) || new Set();
      set.add(listener);
      sessionListeners.set(sessionId, set);
      return () => set.delete(listener);
    },
    rememberSession(sessionId, session, applySnapshot) {
      liveSessionIds.add(sessionId);
      sessionSnapshots.set(sessionId, { session, applySnapshot });
    },
    forgetSession(sessionId) {
      liveSessionIds.delete(sessionId);
      sessionListeners.delete(sessionId);
      sessionSnapshots.delete(sessionId);
    },
    isConnected() {
      return Boolean(child?.connected);
    },
    async reloadChild() {
      if (child) {
        try {
          child.removeAllListeners('exit');
          child.kill('SIGTERM');
        } catch {
        }
        child = null;
      }
      started = null;
      return ensureStarted();
    },
    async createSession(input) {
      await ensureStarted();
      const created = await call('createSession', serializeNodeKernelCreateSessionInput(input));
      const snapshot = created?.session || created;
      return createRemotePiSession(api, snapshot);
    },
    async createPackageManager() {
      await ensureStarted();
      return {
        install: (...args) => call('packageManager', { name: 'install', args }),
        update: (...args) => call('packageManager', { name: 'update', args }),
        removeAndPersist: (...args) => call('packageManager', { name: 'removeAndPersist', args }),
      };
    },
    interruptSessionIds() {
      return Array.from(liveSessionIds);
    },
    dispose() {
      exitError = new Error('Pi node kernel disposed');
      rejectAll(exitError);
      stopChild('SIGKILL');
      liveSessionIds.clear();
      sessionListeners.clear();
      sessionSnapshots.clear();
    },
  };
  const stopChild = (signal = 'SIGKILL') => {
    process.removeListener('exit', onProcessExit);
    const current = child;
    const pid = current?.pid;
    if (current) {
      try {
        current.removeAllListeners('exit');
      } catch {
      }
      try {
        current.kill('SIGTERM');
      } catch {
      }
      if (pid && signal === 'SIGKILL') {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
        }
      }
    }
    child = null;
    started = null;
    reapPiChromeCdpProcesses();
  };
  const onProcessExit = () => {
    stopChild('SIGKILL');
  };
  process.on('exit', onProcessExit);
  return api;
};

export const createNodeKernelHost = (options = {}) => {
  const versions = options.versions || (typeof options.getProcessVersions === 'function'
    ? options.getProcessVersions()
    : process.versions);
  const env = options.env || process.env;
  let kernelReady = false;
  let lastReadyError = null;
  let client = null;
  const mock = options.mock === true;
  const runtime = resolvePiNodeRuntime({
    env,
    versions,
    execPath: options.execPath || process.execPath,
    platform: options.platform || process.platform,
    resourcesPath: options.resourcesPath,
    nodeBinary: options.nodeBinary,
  });

  const emitInterrupted = (sessionIds, onEvent) => {
    if (typeof onEvent !== 'function' || sessionIds.length === 0) return;
    const first = sessionIds[0];
    onEvent('global', {
      type: 'openchamber:notification',
      properties: {
        title: sessionIds.length > 1 ? 'Chats interrupted' : 'Chat interrupted',
        body: 'Pi restarted during a running response. Send a message to continue.',
        tag: KERNEL_RELOAD_INTERRUPTED_KIND,
        kind: KERNEL_RELOAD_INTERRUPTED_KIND,
        sessionId: first,
      },
    });
    for (const sessionID of sessionIds) {
      onEvent('global', {
        type: 'session.error',
        properties: {
          sessionID,
          error: {
            name: 'MessageAbortedError',
            message: 'The running turn was interrupted when the Pi kernel child exited.',
          },
        },
      });
      onEvent('global', {
        type: 'session.idle',
        properties: { sessionID },
      });
    }
  };

  if (runtime.ok) {
    client = createNodeKernelClient({
      ...options,
      versions,
      env,
      onHostEvent: options.onEvent,
      onChildExit: ({ sessionIds }) => {
        kernelReady = false;
        emitInterrupted(sessionIds, options.onEvent);
      },
    });
  }

  const missing = () => {
    throw createMissingNodeError(runtime);
  };

  const host = createPiHost({
    ...options,
    getProcessVersions: options.getProcessVersions || (() => versions),
    electronNativeIsolation: false,
    allowInMemoryFallback: false,
    createDirectoryRuntime: options.createDirectoryRuntime || (async ({ cwd }) => ({
      session: null,
      directory: cwd,
    })),
    createSession: client
      ? async (input) => client.createSession(input)
      : missing,
    createPackageManager: client
      ? async () => client.createPackageManager()
      : missing,
  });

  const originalReady = host.ready.bind(host);
  const originalReload = host.reload.bind(host);
  const originalDispose = host.dispose.bind(host);
  const originalGetKernelInfo = host.getKernelInfo.bind(host);

  host.ready = async () => {
    if (!runtime.ok || !client) {
      kernelReady = false;
      lastReadyError = createMissingNodeError(runtime);
      console.error(`[pi-host] ${runtime.message} ${runtime.recovery}`);
      return false;
    }
    try {
      await client.ensureStarted();
      const hello = await client.call('hello');
      if (hello && /(?:^|[\\/])pi(?:\.exe)?$/i.test(String(hello.execPath || ''))) {
        throw new Error('Node kernel refused to start PATH pi');
      }
      if (!mock && !isSdkHelloReady(hello)) {
        throw createSdkUnavailableError(hello);
      }
      await originalReady();
      lastReadyError = null;
      kernelReady = true;
      return true;
    } catch (error) {
      kernelReady = false;
      lastReadyError = error?.recovery ? error : createSdkUnavailableError(error);
      console.error(`[pi-host] node kernel failed: ${error?.message || error}`);
      return false;
    }
  };
  const originalCreateSession = host.createSession.bind(host);
  host.createSession = async (input) => {
    if (!kernelReady) {
      const ok = await host.ready();
      if (!ok) {
        throw lastReadyError
          || (!runtime.ok ? createMissingNodeError(runtime) : createSdkUnavailableError(client?.describe()?.hello));
      }
    }
    return originalCreateSession(input);
  };
  host.reload = async (reloadOptions) => {
    if (!runtime.ok || !client) {
      throw createMissingNodeError(runtime);
    }
    if (!client.isConnected()) {
      await client.ensureStarted();
    }
    if (!mock) {
      const hello = await client.call('hello');
      if (!isSdkHelloReady(hello)) {
        kernelReady = false;
        lastReadyError = createSdkUnavailableError(hello);
        throw lastReadyError;
      }
    }
    const result = await originalReload(reloadOptions);
    kernelReady = true;
    return result;
  };
  host.dispose = () => {
    client?.dispose();
    originalDispose();
    kernelReady = false;
  };
  host.isReady = () => kernelReady;
  host.getNodeRuntime = () => client?.describe() || runtime;
  host.listLoadedUserNativeDiagnostics = () => [];
  host.getKernelInfo = () => ({
    ...originalGetKernelInfo(),
    sessionLoader: 'node',
    nodeRuntime: host.getNodeRuntime(),
  });
  return host;
};
