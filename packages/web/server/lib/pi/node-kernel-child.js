import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createInMemoryPiSession, createPiHost } from './pi-host.js';
import { createPichamberControlTool, PICHAMBER_CONTROL_TOOL_NAME } from './pichamber-control-tool.js';
import { createPichamberWebTool, PICHAMBER_WEB_TOOL_NAME } from './pichamber-web-tool.js';
import { NODE_KERNEL_PROTOCOL, serializeKernelError, serializeSessionSnapshot } from './node-kernel-protocol.js';
import { PI_SDK_PACKAGE } from './pi-upgrade-status.js';

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

const wrapSession = (session, extras = {}) => {
  const originalBind = typeof session.bindExtensions === 'function'
    ? session.bindExtensions.bind(session)
    : null;
  session.bindExtensions = async (bindings = {}) => {
    const ui = {
      async select(title, options, opts) {
        return parentRequest('ui.select', {
          sessionId: session.sessionId,
          title,
          options,
          opts,
        });
      },
      async confirm(title, message) {
        return parentRequest('ui.confirm', {
          sessionId: session.sessionId,
          title,
          message,
        });
      },
      async input(title, opts) {
        return parentRequest('ui.input', {
          sessionId: session.sessionId,
          title,
          opts,
        });
      },
      async editor(title, opts) {
        return parentRequest('ui.editor', {
          sessionId: session.sessionId,
          title,
          opts,
        });
      },
      notify(message, level) {
        return parentRequest('ui.notify', {
          sessionId: session.sessionId,
          message,
          level,
        });
      },
    };
    const next = {
      ...bindings,
      uiContext: bindings.uiContext || ui,
      mode: bindings.mode || 'rpc',
    };
    if (originalBind) return originalBind(next);
    session.extensionBindings = next;
    return undefined;
  };
  if (typeof session.subscribe === 'function') {
    session.subscribe((event) => {
      send({
        type: 'session-event',
        sessionId: session.sessionId,
        event,
      });
    });
  }
  sessions.set(session.sessionId, session);
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

const resolveSdkInfo = () => {
  try {
    const pkgPath = require.resolve(`${PI_SDK_PACKAGE}/package.json`);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return {
      package: PI_SDK_PACKAGE,
      version: pkg.version || '',
      packagePath: pkgPath,
    };
  } catch {
    return {
      package: PI_SDK_PACKAGE,
      version: '',
      packagePath: '',
    };
  }
};

const createChildSession = async (input = {}) => {
  const customTools = await attachCustomTools();
  const cwd = input.directory || input.cwd || boot?.defaultDirectory || process.cwd();
  const agentDir = boot?.agentDir;
  if (boot?.mock) {
    const session = createInMemoryPiSession({
      sessionId: input.sessionId,
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
  if (!host) {
    host = createPiHost({
      mock: false,
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
  }
  const record = await host.createSession(input);
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
    return {
      protocol: NODE_KERNEL_PROTOCOL,
      pid: process.pid,
      execPath: process.execPath,
      argv: process.argv,
      versions: process.versions,
      sdk: resolveSdkInfo(),
      cwd: process.cwd(),
    };
  }
  if (method === 'ready') {
    return { ok: true };
  }
  if (method === 'createSession') {
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
    if (!host) {
      host = createPiHost({
        mock: boot?.mock === true,
        home: boot?.home,
        defaultDirectory: boot?.defaultDirectory || process.cwd(),
        getProcessVersions: () => process.versions,
        electronNativeIsolation: false,
      });
      await host.ready();
    }
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
    send({
      type: 'ready',
      hello: await handleCall('hello'),
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
