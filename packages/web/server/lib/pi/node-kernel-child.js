import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createInMemoryPiSession, createPiHost } from './pi-host.js';
import { createPichamberControlTool, PICHAMBER_CONTROL_TOOL_NAME } from './pichamber-control-tool.js';
import { createPichamberWebTool, PICHAMBER_WEB_TOOL_NAME } from './pichamber-web-tool.js';
import { NODE_KERNEL_PROTOCOL, serializeKernelError, serializeSessionSnapshot } from './node-kernel-protocol.js';
import { bindNodeKernelChildUiContext } from './node-kernel-ui.js';
import {
  PI_SDK_PACKAGE,
  createSdkUnavailableError,
  isSdkHelloReady,
  resolveInstalledPiSdkInfo,
} from './node-runtime.js';
import { resolvePiAgentDir } from './pi-resources.js';
import {
  installUserExtensionNodeTreeRemap,
  syncUserExtensionNodeTree,
} from './user-extension-node-tree.js';

const require = createRequire(import.meta.url);
const send = (message) => {
  if (typeof process.send === 'function') {
    process.send(message);
    return;
  }
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const parentRequests = new Map();
let parentRequestId = 0;
const sessions = new Map();
let host = null;
let boot = null;

const parentRequest = (method, params) => new Promise((resolve, reject) => {
  const id = `child-${++parentRequestId}`;
  parentRequests.set(id, { resolve, reject });
  send({ type: 'parent-call', id, method, params });
});

const readJson = (filePath) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const packageNameFromSource = (source) => {
  const value = typeof source === 'string' ? source.trim() : '';
  if (!value) return '';
  return value.startsWith('npm:') ? value.slice(4).replace(/@[^@/]+$/, '') : value;
};

const loadUserNpmExtensions = ({ agentDir, projectDir }) => {
  const loaded = [];
  const errors = [];
  const settings = readJson(path.join(agentDir, 'settings.json'));
  const names = (Array.isArray(settings.packages) ? settings.packages : [])
    .map(packageNameFromSource)
    .filter(Boolean);
  const trees = [
    agentDir ? path.join(agentDir, 'npm', 'node_modules') : '',
    projectDir ? path.join(projectDir, '.pi', 'npm', 'node_modules') : '',
  ].filter(Boolean);
  for (const name of names) {
    let loadedName = '';
    for (const tree of trees) {
      const entry = path.join(tree, name, 'index.js');
      if (!fs.existsSync(entry)) continue;
      try {
        require(entry);
        loadedName = name;
        loaded.push({ name, entry });
        break;
      } catch (error) {
        errors.push({ name, path: entry, error: error?.message || String(error) });
      }
    }
    if (!loadedName && !errors.some((item) => item.name === name)) {
      errors.push({ name, error: `Package not found: ${name}` });
    }
  }
  return { loaded, errors };
};

const attachCustomTools = async () => {
  const enabled = await parentRequest('customTools.list', {}).catch(() => ({ control: false, web: false }));
  const tools = [];
  if (enabled?.control) {
    tools.push(createPichamberControlTool({
      executeAction: (action, params, cwd, opts) => parentRequest('customTools.execute', {
        name: PICHAMBER_CONTROL_TOOL_NAME,
        action,
        params,
        cwd,
        signalAborted: Boolean(opts?.signal?.aborted),
      }),
    }));
  }
  if (enabled?.web) {
    tools.push(createPichamberWebTool({
      executeAction: (action, params, cwd, opts) => parentRequest('customTools.execute', {
        name: PICHAMBER_WEB_TOOL_NAME,
        action,
        params,
        cwd,
        signalAborted: Boolean(opts?.signal?.aborted),
      }),
    }));
  }
  return tools.length > 0 ? tools : undefined;
};

const CHILD_SESSION_EVENT_BRIDGE = Symbol('pichamberChildSessionEventBridge');

const wrapSession = (session, extras = {}) => {
  const originalBind = typeof session.bindExtensions === 'function'
    ? session.bindExtensions.bind(session)
    : null;
  session.bindExtensions = async (bindings = {}) => {
    const next = bindNodeKernelChildUiContext(session, bindings, parentRequest);
    if (originalBind) return originalBind(next);
    session.extensionBindings = next;
    return undefined;
  };
  if (typeof session.subscribe === 'function' && !session[CHILD_SESSION_EVENT_BRIDGE]) {
    session[CHILD_SESSION_EVENT_BRIDGE] = true;
    const sessionId = extras.sessionId || session.sessionId;
    session.subscribe((event) => {
      send({
        type: 'session-event',
        sessionId,
        event,
      });
    });
  }
  sessions.set(session.sessionId, session);
  if (extras.sessionId && extras.sessionId !== session.sessionId) {
    sessions.set(extras.sessionId, session);
  }
  return serializeSessionSnapshot(session, extras);
};

const requireSession = (sessionId) => {
  const session = sessions.get(sessionId);
  if (!session) {
    const error = new Error(`Unknown node-kernel session: ${sessionId}`);
    error.status = 404;
    throw error;
  }
  return session;
};

const resolveSdkInfo = async () => {
  if (boot?.failSdkLoad) {
    const message = boot.failSdkLoad === true
      ? 'webidl.util.markAsUncloneable is not a function'
      : String(boot.failSdkLoad);
    return {
      package: PI_SDK_PACKAGE,
      version: '',
      packagePath: '',
      error: message,
    };
  }
  return resolveInstalledPiSdkInfo({ packageName: PI_SDK_PACKAGE });
};

const readSessionIdFromFile = (file) => {
  if (typeof file !== 'string' || !file || !fs.existsSync(file)) return '';
  try {
    const first = fs.readFileSync(file, 'utf8').split('\n').find((line) => line.trim());
    if (!first) return '';
    const parsed = JSON.parse(first);
    return typeof parsed?.id === 'string' && parsed.id.trim() ? parsed.id.trim() : '';
  } catch {
    return '';
  }
};

const prepareChildUserNatives = async () => {
  const agentDir = typeof boot?.agentDir === 'string' && boot.agentDir.trim()
    ? boot.agentDir.trim()
    : resolvePiAgentDir(boot?.home);
  const projectDir = boot?.defaultDirectory || process.cwd();
  await syncUserExtensionNodeTree({
    agentDir,
    projectDir,
    versions: process.versions,
    nodeBinary: process.execPath,
  });
  installUserExtensionNodeTreeRemap({
    agentDir,
    projectDir,
    versions: process.versions,
  });
};

const ensureChildHost = async () => {
  if (host) return host;
  await prepareChildUserNatives();
  host = createPiHost({
    mock: false,
    allowInMemoryFallback: false,
    home: boot?.home,
    defaultDirectory: boot?.defaultDirectory || process.cwd(),
    getProcessVersions: () => process.versions,
    getCustomTools: attachCustomTools,
    electronNativeIsolation: false,
    onEvent: (directory, event) => {
      send({ type: 'host-event', directory, event });
    },
  });
  await host.ready();
  return host;
};

const openOrCreateChildSession = async (input = {}) => {
  const childHost = await ensureChildHost();
  const sessionFile = typeof input.sessionFile === 'string' ? input.sessionFile.trim() : '';
  const sessionID = typeof input.sessionID === 'string' && input.sessionID.trim()
    ? input.sessionID.trim()
    : readSessionIdFromFile(sessionFile);
  if (sessionID) {
    return childHost.ensureSession(sessionID, input.directory || input.cwd);
  }
  return childHost.createSession(input);
};

const createChildSession = async (input = {}) => {
  const customTools = await attachCustomTools();
  const cwd = input.directory || input.cwd || boot?.defaultDirectory || process.cwd();
  const agentDir = boot?.agentDir;
  if (boot?.mock) {
    const session = createInMemoryPiSession({
      sessionId: input.sessionId || input.sessionID,
      customTools,
    });
    if (boot.loadUserNpmExtensions && agentDir) {
      const result = loadUserNpmExtensions({ agentDir, projectDir: cwd });
      session.extensionsResult = result;
      for (const item of result.loaded) {
        session.registerCommand(`ext-${item.name}`, async () => {}, {
          description: item.name,
        });
      }
    }
    return wrapSession(session, {
      toolNames: (customTools || []).map((tool) => tool.name),
    });
  }
  const record = await openOrCreateChildSession(input);
  if (record?.piSession) {
    wrapSession(record.piSession, {
      sessionId: record.id,
      sessionFile: record.sessionFile,
      toolNames: (customTools || []).map((tool) => tool.name),
    });
  }
  return {
    record: {
      id: record.id,
      directory: record.directory,
      info: record.info,
      sessionFile: record.sessionFile,
    },
    session: serializeSessionSnapshot(record.piSession, {
      sessionId: record.id,
      sessionFile: record.sessionFile,
    }),
  };
};

const handleCall = async (method, params = {}) => {
  if (method === 'hello') {
    const sdk = await resolveSdkInfo();
    return {
      protocol: NODE_KERNEL_PROTOCOL,
      pid: process.pid,
      execPath: process.execPath,
      argv: process.argv,
      versions: process.versions,
      sdk,
      cwd: process.cwd(),
    };
  }
  if (method === 'ready') {
    const hello = await handleCall('hello');
    if (!boot?.mock && !isSdkHelloReady(hello)) {
      throw createSdkUnavailableError(hello);
    }
    return { ok: true, hello };
  }
  if (method === 'createSession') {
    if (!boot?.mock) {
      const hello = await handleCall('hello');
      if (!isSdkHelloReady(hello)) {
        throw createSdkUnavailableError(hello);
      }
    }
    return createChildSession(params);
  }
  if (method === 'session.method') {
    const session = requireSession(params.sessionId);
    const target = params.target === 'sessionManager' ? session.sessionManager : session;
    const fn = target?.[params.name];
    if (typeof fn !== 'function') {
      if (params.name in (target || {})) return target[params.name];
      throw new Error(`Session method is not available: ${params.name}`);
    }
    const result = await fn.apply(target, params.args || []);
    return {
      result,
      snapshot: serializeSessionSnapshot(session),
    };
  }
  if (method === 'session.get') {
    const session = requireSession(params.sessionId);
    return serializeSessionSnapshot(session);
  }
  if (method === 'packageManager') {
    await ensureChildHost();
    const manager = await host.resolveFeaturePackageManager();
    const fn = manager?.[params.name];
    if (typeof fn !== 'function') {
      throw new Error(`PackageManager method is not available: ${params.name}`);
    }
    return fn.apply(manager, params.args || []);
  }
  if (method === 'host.method') {
    if (!host) {
      throw new Error('Node kernel host is not started');
    }
    const fn = host[params.name];
    if (typeof fn !== 'function') {
      throw new Error(`Host method is not available: ${params.name}`);
    }
    return fn.apply(host, params.args || []);
  }
  throw new Error(`Unknown node-kernel method: ${method}`);
};

const onMessage = async (message) => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'boot') {
    boot = message.boot || {};
    const hello = await handleCall('hello');
    send({
      type: 'ready',
      hello,
      error: !boot.mock && !isSdkHelloReady(hello)
        ? serializeKernelError(createSdkUnavailableError(hello))
        : undefined,
    });
    return;
  }
  if (message.type === 'parent-result') {
    const pending = parentRequests.get(message.id);
    if (!pending) return;
    parentRequests.delete(message.id);
    if (message.ok) pending.resolve(message.value);
    else pending.reject(restoreError(message.error));
    return;
  }
  if (message.type === 'call') {
    try {
      const value = await handleCall(message.method, message.params);
      send({ type: 'result', id: message.id, ok: true, value });
    } catch (error) {
      send({ type: 'result', id: message.id, ok: false, error: serializeKernelError(error) });
    }
  }
};

const restoreError = (payload) => {
  const error = new Error(payload?.message || 'Parent kernel request failed');
  if (payload?.status) error.status = payload.status;
  if (payload?.code) error.code = payload.code;
  return error;
};

process.on('message', onMessage);
if (!process.send) {
  process.stdin.setEncoding('utf8');
  let buffer = '';
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        try {
          onMessage(JSON.parse(line));
        } catch (error) {
          send({ type: 'result', ok: false, error: serializeKernelError(error) });
        }
      }
      index = buffer.indexOf('\n');
    }
  });
}

send({
  type: 'hello',
  child: fileURLToPath(import.meta.url),
  pid: process.pid,
});
