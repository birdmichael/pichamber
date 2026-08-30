import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { SessionManager, CURRENT_SESSION_VERSION } from '@earendil-works/pi-coding-agent';
import { createPiKernel } from './index.js';
import { resolveKernelName } from './kernel.js';
import { PI_NODE_UNAVAILABLE_CODE, PI_SDK_UNAVAILABLE_CODE, toNodeReadablePath } from './node-runtime.js';
import { createNodeKernelClient, dispatchNodeKernelParentUiCall, mergeRemoteSessionSnapshot, reapPiChromeCdpProcesses, resolveNodeKernelChildScript, serializeNodeKernelCreateSessionInput, shouldForwardNodeKernelHostEvent } from './node-kernel-client.js';
import { serializeSessionCommands, serializeSessionSnapshot } from './node-kernel-protocol.js';
import { bindNodeKernelChildUiContext, serializeUiOpts } from './node-kernel-ui.js';
import { createInMemoryPiSession, createPiHost, sessionDirForCwd } from './pi-host.js';
import { resolvePiAgentDir } from './pi-resources.js';

const require = createRequire(import.meta.url);
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const tempDir = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

const writeNativeFixture = (tree, name) => {
  const dir = path.join(tree, 'node_modules', name);
  const nodePath = path.join(dir, 'build', 'Release', 'addon.node');
  fs.mkdirSync(path.dirname(nodePath), { recursive: true });
  fs.writeFileSync(nodePath, Buffer.from('not-a-real-native'));
  writeJson(path.join(dir, 'package.json'), {
    name,
    version: '0.0.0',
    main: 'index.js',
    pi: { extensions: ['./index.js'] },
  });
  fs.writeFileSync(path.join(dir, 'binding.gyp'), '{ "targets": [{ "target_name": "addon" }] }\n');
  fs.writeFileSync(path.join(dir, 'index.js'), [
    "'use strict';",
    "const path = require('path');",
    "const nodePath = path.join(__dirname, 'build/Release/addon.node');",
    'const original = process.dlopen;',
    'process.dlopen = function dlopen(mod, filename) {',
    '  if (filename === nodePath) {',
    "    if (process.versions.electron) throw new Error('Electron must not load this package');",
    '    mod.exports = {',
    "      ping: () => 'from-node',",
    '      execPath: process.execPath,',
    '      electron: process.versions.electron || null,',
    '      modules: process.versions.modules,',
    '    };',
    '    return;',
    '  }',
    '  return original.apply(this, arguments);',
    '};',
    'module.exports = require(nodePath);',
    '',
  ].join('\n'));
  return { dir, entry: path.join(dir, 'index.js'), nodePath };
};

const writeJsExtension = (tree, name) => {
  const dir = path.join(tree, 'node_modules', name);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, 'package.json'), {
    name,
    version: '0.0.0',
    main: 'index.js',
    pi: { extensions: ['./index.js'] },
  });
  fs.writeFileSync(path.join(dir, 'index.js'), `module.exports = { name: ${JSON.stringify(name)} };\n`);
  return { dir, entry: path.join(dir, 'index.js') };
};

const createDesktopKernel = ({ home, cwd, extraEnv = {}, getCustomTools } = {}) => (
  createPiKernel({
    mock: true,
    useNodeKernel: true,
    loadUserNpmExtensions: true,
    nodeBinary: process.execPath,
    home,
    defaultDirectory: cwd,
    versions: { electron: '43.0.0', modules: '88' },
    env: { ...process.env, ...extraEnv },
    getCustomTools,
  })
);

const waitFor = async (read, predicate, timeoutMs = 3000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for node-kernel condition');
};

describe('P1b node kernel (cases 19-22, 24-27)', () => {
  it('19: does not dlopen user natives in the Electron-shaped parent', async () => {
    const home = tempDir('pi-node-home-');
    const cwd = tempDir('pi-node-cwd-');
    const npm = path.join(home, '.pi', 'agent', 'npm');
    const fixture = writeNativeFixture(npm, 'native-fixture');
    writeJsExtension(npm, 'good-js');
    writeJson(path.join(home, '.pi', 'agent', 'settings.json'), {
      packages: ['npm:native-fixture', 'npm:good-js'],
    });

    const opened = [];
    const originalDlopen = process.dlopen;
    process.dlopen = function spyDlopen(mod, filename) {
      opened.push(filename);
      return originalDlopen.apply(this, arguments);
    };

    const kernel = createDesktopKernel({ home, cwd });
    try {
      await expect(kernel.ready()).resolves.toBe(true);
      const session = await kernel.host.createSession({ directory: cwd });
      await kernel.host.promptAsync(session.id, { parts: [{ type: 'text', text: 'hello' }] });
      expect(opened.some((file) => file === fixture.nodePath || String(file).includes('native-fixture'))).toBe(false);
      expect(Object.keys(require.cache || {}).some((file) => file === fixture.entry)).toBe(false);
      const commands = kernel.host.listCommands(cwd, { sessionID: session.id });
      expect(commands.some((command) => command.name === 'ext-native-fixture')).toBe(true);
      expect(commands.some((command) => command.name === 'ext-good-js')).toBe(true);
      expect(kernel.host.getNodeRuntime().hello.execPath).toBe(process.execPath);
      expect(kernel.host.getNodeRuntime().hello.versions.electron || '').toBe('');
    } finally {
      process.dlopen = originalDlopen;
      kernel.dispose();
    }
  });

  it('20: a system-Node fixture works without an Electron rebuild tree', async () => {
    const home = tempDir('pi-node-home-');
    const cwd = tempDir('pi-node-cwd-');
    const npm = path.join(home, '.pi', 'agent', 'npm');
    writeNativeFixture(npm, 'native-fixture');
    writeJson(path.join(home, '.pi', 'agent', 'settings.json'), {
      packages: ['npm:native-fixture'],
    });

    const kernel = createDesktopKernel({ home, cwd });
    try {
      await kernel.ready();
      const session = await kernel.host.createSession({ directory: cwd });
      expect(kernel.host.listCommands(cwd, { sessionID: session.id }).some((command) => (
        command.name === 'ext-native-fixture'
      ))).toBe(true);
      expect(fs.existsSync(path.join(home, '.pi', 'agent', 'npm-electron'))).toBe(false);
    } finally {
      kernel.dispose();
    }
  });

  it('21: ignores a decoy pi on PATH and uses the app-bundled child script', async () => {
    const home = tempDir('pi-node-home-');
    const cwd = tempDir('pi-node-cwd-');
    const decoyDir = tempDir('pi-decoy-');
    const decoy = path.join(decoyDir, 'pi');
    fs.writeFileSync(decoy, '#!/bin/sh\necho decoy-pi\n');
    fs.chmodSync(decoy, 0o755);

    const kernel = createDesktopKernel({
      home,
      cwd,
      extraEnv: { PATH: `${decoyDir}${path.delimiter}${process.env.PATH || ''}` },
    });
    try {
      await kernel.ready();
      const hello = kernel.host.getNodeRuntime().hello;
      expect(hello.execPath).toBe(process.execPath);
      expect(hello.argv[0]).toBe(process.execPath);
      expect(hello.argv.some((arg) => arg === decoy || /(^|[\\/])pi$/.test(String(arg)))).toBe(false);
      expect(String(hello.argv[1] || '')).toMatch(/node-kernel-child\.js$/);
      expect(hello.sdk.package).toBe('@earendil-works/pi-coding-agent');
    } finally {
      kernel.dispose();
    }
  });

  it('22b: SDK load failure in the Node child is not a mock-ready kernel', async () => {
    const home = tempDir('pi-node-home-');
    const cwd = tempDir('pi-node-cwd-');
    const kernel = createPiKernel({
      mock: false,
      useNodeKernel: true,
      failSdkLoad: 'webidl.util.markAsUncloneable is not a function',
      nodeBinary: process.execPath,
      home,
      defaultDirectory: cwd,
      versions: { electron: '43.0.0', modules: '88' },
      env: { ...process.env },
    });
    try {
      await expect(kernel.ready()).resolves.toBe(false);
      expect(kernel.host.isReady()).toBe(false);
      const runtime = kernel.host.getNodeRuntime();
      expect(runtime.hello?.sdk?.packagePath || '').toBe('');
      expect(runtime.message).toMatch(/markAsUncloneable/);
      expect(runtime.message).not.toMatch(/Node\.js was not found/);
      await expect(kernel.host.createSession({ directory: cwd })).rejects.toMatchObject({
        code: PI_SDK_UNAVAILABLE_CODE,
        status: 503,
        message: expect.not.stringMatching(/Node\.js was not found/),
        recovery: expect.stringMatching(/PICHAMBER_NODE_BINARY/),
      });
    } finally {
      kernel.dispose();
    }
  });

  it('22: missing Node is a clear error plus recovery, not a half-up kernel', async () => {
    const home = tempDir('pi-node-home-');
    const cwd = tempDir('pi-node-cwd-');
    const decoyDir = tempDir('pi-decoy-node-');
    const decoy = path.join(decoyDir, 'node');
    fs.writeFileSync(decoy, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(decoy, 0o755);
    const kernel = createPiKernel({
      mock: true,
      useNodeKernel: true,
      nodeBinary: path.join(home, 'missing-node'),
      home,
      defaultDirectory: cwd,
      versions: { electron: '43.0.0', modules: '88' },
      env: { PATH: '' },
      wellKnownPaths: [decoy],
    });
    try {
      await expect(kernel.ready()).resolves.toBe(false);
      expect(kernel.host.isReady()).toBe(false);
      await expect(kernel.host.createSession({ directory: cwd })).rejects.toMatchObject({
        code: PI_NODE_UNAVAILABLE_CODE,
        status: 503,
        recovery: expect.stringMatching(/PICHAMBER_NODE_BINARY/),
      });
    } finally {
      kernel.dispose();
    }
  });

  it('does not hydrate a disk session onto the mock Hello when the Node child is down', async () => {
    const home = tempDir('pi-node-home-');
    const cwd = tempDir('pi-node-cwd-');
    const sessionDir = sessionDirForCwd(cwd, home);
    const manager = SessionManager.create(cwd, sessionDir);
    const file = manager.getSessionFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({
      type: 'session',
      version: CURRENT_SESSION_VERSION,
      id: manager.getSessionId(),
      timestamp: new Date().toISOString(),
      cwd: manager.getCwd(),
    })}\n`);
    const opened = SessionManager.open(file, sessionDir);
    opened.appendMessage({
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
      timestamp: Date.now(),
    });
    const sessionId = opened.getSessionId();

    const { EventEmitter } = require('node:events');
    const kernel = createPiKernel({
      useNodeKernel: true,
      nodeBinary: process.execPath,
      home,
      defaultDirectory: cwd,
      versions: { electron: '43.0.0', modules: '88' },
      spawnImpl: () => {
        const fake = new EventEmitter();
        fake.connected = false;
        fake.send = () => {};
        fake.kill = () => {};
        process.nextTick(() => {
          fake.emit('error', Object.assign(new Error('ENOENT: missing node-kernel-child.js'), {
            code: 'ENOENT',
          }));
        });
        return fake;
      },
    });
    try {
      await expect(kernel.ready()).resolves.toBe(false);
      expect(kernel.host.isReady()).toBe(false);
      await expect(kernel.host.ensureSession(sessionId, cwd)).rejects.toThrow(/ENOENT|not become ready|unavailable|node kernel/i);
      expect(() => kernel.host.getSession(sessionId)).toThrow(/Session not found/);
      await expect(
        kernel.host.promptAsync(sessionId, { parts: [{ type: 'text', text: 'again' }] }),
      ).rejects.toThrow();
    } finally {
      kernel.dispose();
    }
  });

  it('23: Plan cards, in-process create-send-fork, and scheduled-task session create work over IPC', async () => {
    const home = tempDir('pi-node-home-');
    const cwd = tempDir('pi-node-cwd-');
    const events = [];
    const kernel = createPiKernel({
      mock: true,
      useNodeKernel: true,
      loadUserNpmExtensions: true,
      nodeBinary: process.execPath,
      home,
      defaultDirectory: cwd,
      versions: { electron: '43.0.0', modules: '88' },
      onEvent: (_directory, event) => events.push(event),
    });
    try {
      await kernel.ready();
      const record = await kernel.host.createSession({ directory: cwd, title: 'IPC plan' });
      const plan = kernel.host.runCommand(record.id, { command: 'plan' });
      const prompts = await waitFor(
        () => kernel.host.listExtensionUIPrompts(record.id),
        (items) => items.length > 0,
      );
      expect(prompts[0].kind).toBe('select');
      expect(events.some((event) => event.type === 'pi.ui.asked')).toBe(true);
      kernel.host.replyExtensionUI(record.id, prompts[0].id, prompts[0].options[0]);
      await plan;

      const created = await kernel.host.createSession({ directory: cwd, title: 'control' });
      await kernel.host.promptAsync(created.id, { parts: [{ type: 'text', text: 'from tool' }] });
      const forked = await kernel.host.forkSession(created.id, kernel.host.getMessages(created.id)[0]?.info?.id);
      expect(forked.id).toBeTruthy();
      expect(forked.id).not.toBe(created.id);
      expect(kernel.host.getMessages(created.id).length).toBeGreaterThan(0);

      // Scheduled-task session create and `pichamber` create-send-fork both use
      // these host methods (not HTTP). The Plan card above is the ctx.ui IPC.
      const scheduled = await kernel.host.createSession({ directory: cwd, title: 'Scheduled ping 12:00' });
      await kernel.host.promptAsync(scheduled.id, { parts: [{ type: 'text', text: 'scheduled work' }] });
      expect(scheduled.id).toBeTruthy();
    } finally {
      kernel.dispose();
    }
  });

  it('24: a kernel child crash does not quit the parent and reload respawns', async () => {
    const home = tempDir('pi-node-home-');
    const cwd = tempDir('pi-node-cwd-');
    const events = [];
    const kernel = createDesktopKernel({ home, cwd });
    kernel.bus.publish = (directory, event) => events.push({ directory, event });
    const originalOnEvent = kernel.host;
    void originalOnEvent;
    try {
      await kernel.ready();
      const session = await kernel.host.createSession({ directory: cwd, title: 'crash' });
      const clientPid = kernel.host.getNodeRuntime().hello.pid;
      expect(clientPid).toBeTruthy();
      process.kill(clientPid, 'SIGKILL');
      await waitFor(
        () => kernel.host.getNodeRuntime(),
        (runtime) => !runtime.pid || runtime.pid !== clientPid,
      );
      expect(process.pid).not.toBe(clientPid);
      await waitFor(
        () => events,
        (items) => items.some((item) => item.event?.type === 'session.error')
          && items.some((item) => item.event?.properties?.kind === 'opencode-restart-interrupted'),
      );
      await expect(kernel.host.reload()).resolves.toMatchObject({ reloaded: true, kernel: 'pi' });
      const again = await kernel.host.createSession({ directory: cwd, title: 'after-reload' });
      expect(again.id).toBeTruthy();
      expect(again.id).not.toBe(session.id);
    } finally {
      kernel.dispose();
    }
  });

  it('25-27: Feature Plugin chrome, reload 409, and leftover OpenCode stay on their existing paths', async () => {
    const home = tempDir('pi-node-home-');
    const cwd = tempDir('pi-node-cwd-');
    writeJson(path.join(home, '.pi', 'agent', 'settings.json'), {
      packages: ['npm:@narumitw/pi-plan-mode'],
    });
    const kernel = createDesktopKernel({ home, cwd });
    try {
      await kernel.ready();
      expect(kernel.host.getFeaturePlugins().slots.plan).toMatchObject({
        installed: true,
        enabled: true,
      });
      const busy = await kernel.host.createSession({ directory: cwd, title: 'busy' });
      const prompt = kernel.host.promptAsync(busy.id, { parts: [{ type: 'text', text: 'stream' }] });
      await expect(kernel.host.reload({ sessionID: busy.id })).rejects.toMatchObject({ status: 409 });
      await prompt;
      expect(resolveKernelName({ OPENCHAMBER_KERNEL: 'opencode' })).toBe('opencode');
      expect(createPiKernel({
        mock: true,
        env: { OPENCHAMBER_KERNEL: 'pi' },
        versions: {},
      }).sessionLoader).toBe('in-process');
    } finally {
      kernel.dispose();
    }
  });
});

describe('node kernel ctx.ui stub', () => {
  it('bindExtensions uiContext noops TUI helpers pi-subagents calls when hasUI is true', async () => {
    const session = createInMemoryPiSession({ sessionId: 'child-ui' });
    const parentCalls = [];
    const parentRequest = async (method, params) => {
      parentCalls.push({ method, params });
      return 'from-parent';
    };
    const originalBind = session.bindExtensions.bind(session);
    session.bindExtensions = async (bindings = {}) => (
      originalBind(bindNodeKernelChildUiContext(session, bindings, parentRequest))
    );

    await session.bindExtensions({ mode: 'rpc' });
    const ui = session.extensionBindings.uiContext;
    expect(typeof ui.setToolsExpanded).toBe('function');
    expect(typeof ui.setWidget).toBe('function');
    expect(typeof ui.setStatus).toBe('function');
    expect(typeof ui.getToolsExpanded).toBe('function');
    expect(() => ui.setToolsExpanded(false)).not.toThrow();
    expect(() => ui.setWidget(null)).not.toThrow();
    expect(() => ui.setStatus('working')).not.toThrow();
    expect(ui.getToolsExpanded()).toBe(false);
    expect(parentCalls).toEqual([]);
    await expect(ui.select('Pick', ['A'])).resolves.toBe('from-parent');
    expect(parentCalls[0]).toMatchObject({
      method: 'ui.select',
      params: { sessionId: 'child-ui', title: 'Pick', options: ['A'] },
    });
    const childSource = fs.readFileSync(new URL('./node-kernel-child.js', import.meta.url), 'utf8');
    expect(childSource.includes('bindNodeKernelChildUiContext')).toBe(true);
  });

  it('serializes AbortSignal to aborted-only so IPC cannot invent addEventListener', () => {
    expect(serializeUiOpts({
      multiple: true,
      signal: new AbortController().signal,
    })).toEqual({
      multiple: true,
      signal: { aborted: false },
    });
    const abort = new AbortController();
    abort.abort();
    expect(serializeUiOpts({ signal: abort.signal })).toEqual({ signal: { aborted: true } });
    expect(serializeUiOpts('type something')).toBeUndefined();
  });

  it('sends input placeholder and editor prefill as their own IPC fields', async () => {
    const session = createInMemoryPiSession({ sessionId: 'child-ui-text' });
    const parentCalls = [];
    const parentRequest = async (method, params) => {
      parentCalls.push({ method, params });
      return 'from-parent';
    };
    const originalBind = session.bindExtensions.bind(session);
    session.bindExtensions = async (bindings = {}) => (
      originalBind(bindNodeKernelChildUiContext(session, bindings, parentRequest))
    );
    await session.bindExtensions({ mode: 'rpc' });
    const ui = session.extensionBindings.uiContext;

    await expect(ui.input('Enter', 'type something...')).resolves.toBe('from-parent');
    expect(parentCalls.at(-1)).toEqual({
      method: 'ui.input',
      params: {
        sessionId: 'child-ui-text',
        title: 'Enter',
        placeholder: 'type something...',
        opts: undefined,
      },
    });

    await expect(ui.editor('Refine the plan:', '')).resolves.toBe('from-parent');
    expect(parentCalls.at(-1)).toEqual({
      method: 'ui.editor',
      params: {
        sessionId: 'child-ui-text',
        title: 'Refine the plan:',
        prefill: '',
        opts: undefined,
      },
    });

    await expect(ui.editor('Edit', 'Line 1\nLine 2')).resolves.toBe('from-parent');
    expect(parentCalls.at(-1).params.prefill).toBe('Line 1\nLine 2');

    const abort = new AbortController();
    abort.abort();
    await ui.select('Pick', ['A'], { signal: abort.signal });
    expect(parentCalls.at(-1).params.opts).toEqual({ signal: { aborted: true } });
    await ui.input('Enter', 'type something...', { signal: abort.signal });
    expect(parentCalls.at(-1)).toMatchObject({
      method: 'ui.input',
      params: {
        title: 'Enter',
        placeholder: 'type something...',
        opts: { signal: { aborted: true } },
      },
    });

    await ui.input('Enter', { signal: abort.signal });
    expect(parentCalls.at(-1).params.placeholder).toBeUndefined();
    expect(parentCalls.at(-1).params.opts).toEqual({ signal: { aborted: true } });
  });

  it('forwards parent ui.input/editor string args without treating empty prefill as missing', () => {
    const calls = [];
    const ui = {
      input: (...args) => {
        calls.push(['input', args]);
        return 'input-ok';
      },
      editor: (...args) => {
        calls.push(['editor', args]);
        return 'editor-ok';
      },
    };
    expect(dispatchNodeKernelParentUiCall(ui, 'ui.input', {
      title: 'Enter',
      placeholder: 'type something...',
      opts: { signal: { aborted: false } },
    })).toBe('input-ok');
    expect(dispatchNodeKernelParentUiCall(ui, 'ui.editor', {
      title: 'Refine the plan:',
      prefill: '',
    })).toBe('editor-ok');
    expect(calls).toEqual([
      ['input', ['Enter', 'type something...', { signal: { aborted: false } }]],
      ['editor', ['Refine the plan:', '']],
    ]);
  });
});

describe('node kernel client spawn contract', () => {
  it('spawns the provided Node binary with the bundled child script', async () => {
    const home = tempDir('pi-node-home-');
    const seen = [];
    const client = createNodeKernelClient({
      mock: true,
      home,
      defaultDirectory: home,
      nodeBinary: process.execPath,
      versions: { electron: '43.0.0' },
      spawnImpl: (command, args, options) => {
        seen.push({ command, args, envPath: options.env.PATH });
        const { spawn } = require('node:child_process');
        return spawn(command, args, options);
      },
    });
    try {
      await client.ensureStarted();
      const hello = await client.call('hello');
      expect(seen[0].command).toBe(process.execPath);
      expect(seen[0].args[0]).toMatch(/node-kernel-child\.js$/);
      expect(hello.execPath).toBe(process.execPath);
    } finally {
      client.dispose();
    }
  });

  it('boots the child with resolvePiAgentDir even when home is omitted', async () => {
    const { spawn } = require('node:child_process');
    let boot = null;
    const client = createNodeKernelClient({
      mock: true,
      nodeBinary: process.execPath,
      versions: { electron: '43.0.0' },
      spawnImpl: (command, args, options) => {
        const child = spawn(command, args, options);
        const originalSend = child.send.bind(child);
        child.send = (message) => {
          if (message?.type === 'boot') boot = message.boot;
          return originalSend(message);
        };
        return child;
      },
    });
    try {
      await client.ensureStarted();
      expect(boot.home).toBe(os.homedir());
      expect(boot.agentDir).toBe(resolvePiAgentDir());
    } finally {
      client.dispose();
    }
  });

  it('ignores a missing Resources/pi-node-kernel extraResource and spawns the module child', async () => {
    const home = tempDir('pi-node-home-');
    const resourcesPath = tempDir('pi-empty-resources-');
    const seen = [];
    const client = createNodeKernelClient({
      mock: true,
      home,
      defaultDirectory: home,
      resourcesPath,
      nodeBinary: process.execPath,
      versions: { electron: '43.0.0' },
      spawnImpl: (command, args, options) => {
        seen.push({ command, args });
        const { spawn } = require('node:child_process');
        return spawn(command, args, options);
      },
    });
    try {
      await client.ensureStarted();
      expect(seen[0].args[0]).toMatch(/node-kernel-child\.js$/);
      expect(seen[0].args[0]).not.toContain(`${path.sep}pi-node-kernel${path.sep}`);
      expect(seen[0].args[0]).toBe(resolveNodeKernelChildScript());
    } finally {
      client.dispose();
    }
  });

  it('prefers an explicit childScript over the module default', () => {
    const custom = path.join(tempDir('pi-custom-child-'), 'custom-child.js');
    expect(resolveNodeKernelChildScript({ childScript: custom })).toBe(toNodeReadablePath(custom));
    expect(resolveNodeKernelChildScript({ childScript: `  ${custom}  ` })).toBe(toNodeReadablePath(custom));
  });

  it('kills the child process on dispose', async () => {
    const { EventEmitter } = require('node:events');
    const killed = [];
    const fake = new EventEmitter();
    fake.pid = 4242;
    fake.connected = true;
    fake.send = () => {};
    fake.kill = (signal) => {
      killed.push(signal);
    };
    const client = createNodeKernelClient({
      mock: true,
      home: tempDir('pi-node-home-'),
      defaultDirectory: tempDir('pi-node-cwd-'),
      nodeBinary: process.execPath,
      versions: { electron: '43.0.0' },
      spawnImpl: () => fake,
    });
    const started = client.ensureStarted();
    process.nextTick(() => {
      fake.emit('message', { type: 'ready', hello: { execPath: process.execPath } });
    });
    await started;
    const originalKill = process.kill;
    const killSpy = (...args) => {
      killed.push(args);
    };
    process.kill = killSpy;
    try {
      client.dispose();
    } finally {
      process.kill = originalKill;
    }
    expect(killed).toContain('SIGTERM');
    expect(killed.some((item) => Array.isArray(item) && item[0] === 4242 && item[1] === 'SIGKILL')).toBe(true);
  });

  it('reaps detached pi-chrome CDP Chrome processes', () => {
    const killed = [];
    const pids = reapPiChromeCdpProcesses({
      platform: 'darwin',
      selfPid: 1,
      spawnSyncImpl: () => ({ stdout: '5555\n6666\n' }),
      killImpl: (pid, signal) => {
        killed.push([pid, signal]);
      },
    });
    expect(pids).toEqual([5555, 6666]);
    expect(killed).toEqual([
      [5555, 'SIGTERM'],
      [5555, 'SIGKILL'],
      [6666, 'SIGTERM'],
      [6666, 'SIGKILL'],
    ]);
  });

  it('rewrites a packaged asar child path to app.asar.unpacked', () => {
    const packed = [
      '',
      'Applications',
      'Pichamber.app',
      'Contents',
      'Resources',
      'app.asar',
      'node_modules',
      '@pichamber',
      'web',
      'server',
      'lib',
      'pi',
      'node-kernel-child.js',
    ].join(path.sep);
    const resolved = resolveNodeKernelChildScript({ childScript: packed });
    expect(resolved).toContain(`${path.sep}app.asar.unpacked${path.sep}`);
    expect(resolved).not.toContain(`${path.sep}app.asar${path.sep}`);
    expect(resolved).toMatch(/node-kernel-child\.js$/);
  });
});

const listActiveSessionFiles = (cwd, home) => {
  const dir = sessionDirForCwd(cwd, home);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.jsonl'));
};

describe('node kernel session snapshot commands', () => {
  it('normalizes invocationName onto name for the parent getCommands cache', () => {
    expect(serializeSessionCommands([
      { invocationName: 'goal', description: 'Set a goal' },
      { name: '/plan', source: 'prompt', description: 'Plan' },
      { name: 'goal', invocationName: 'goal:1', description: 'Set a goal' },
      { description: 'drop me' },
    ])).toEqual([
      { name: 'goal', description: 'Set a goal', source: 'extension' },
      { name: 'plan', description: 'Plan', source: 'prompt' },
      { name: 'goal', invocationName: 'goal:1', description: 'Set a goal', source: 'extension' },
    ]);
  });

  it('serializes extensionRunner commands when AgentSession has no getCommands()', () => {
    expect(serializeSessionSnapshot({
      sessionId: 'ses_runner',
      extensionRunner: {
        getRegisteredCommands: () => ([
          { name: 'goal', invocationName: 'goal', description: 'Set a goal' },
          { name: 'plan', invocationName: 'plan:1', description: 'Enter or manage Plan mode' },
        ]),
      },
    }).commands).toEqual([
      { name: 'goal', description: 'Set a goal', source: 'extension' },
      { name: 'plan', invocationName: 'plan:1', description: 'Enter or manage Plan mode', source: 'extension' },
    ]);
  });

  it('serializes plan-mode-state from session entries when getPlanModeState is missing', () => {
    expect(serializeSessionSnapshot({
      sessionId: 'ses_plan',
      sessionManager: {
        getEntries: () => ([{
          type: 'custom',
          customType: 'plan-mode-state',
          data: { enabled: true, awaitingAction: false },
        }]),
      },
    }).planModeState).toMatchObject({ enabled: true });
  });

  it('GET/POST plan after start follow child snapshot entries over IPC', async () => {
    const home = tempDir('pi-node-home-');
    const cwd = tempDir('pi-node-cwd-');
    const kernel = createDesktopKernel({ home, cwd });
    try {
      await expect(kernel.ready()).resolves.toBe(true);
      const record = await kernel.host.createSession({ directory: cwd, title: 'Plan ipc' });
      expect(await kernel.host.getSessionPlan(record.id)).toEqual({ status: 'off', planMarkdown: '' });

      const started = await kernel.host.runPlanAction(record.id, { action: 'start' });
      expect(started).toEqual({ status: 'active', planMarkdown: '' });
      expect(await kernel.host.getSessionPlan(record.id)).toEqual({ status: 'active', planMarkdown: '' });
      expect(record.piSession.getPlanModeState()?.enabled).toBe(true);

      record.piSession.setPlanModeState = () => {
        throw new Error('must not IPC setPlanModeState');
      };
      await record.piSession.sessionManager.appendCustomEntry('plan-mode-state', {
        enabled: false,
        savedPlan: { plan: '# Saved over IPC', source: 'plan_mode_complete' },
      });
      const resumed = await kernel.host.runPlanAction(record.id, { action: 'resume' });
      expect(resumed).toMatchObject({
        status: 'ready',
        planMarkdown: '# Saved over IPC',
      });
    } finally {
      kernel.dispose();
    }
  });

  it('refreshes parent getCommands() from the child session.get snapshot', async () => {
    const home = tempDir('pi-node-home-');
    const cwd = tempDir('pi-node-cwd-');
    const kernel = createDesktopKernel({ home, cwd });
    try {
      await expect(kernel.ready()).resolves.toBe(true);
      const record = await kernel.host.createSession({ directory: cwd });
      expect(typeof record.piSession.refreshSnapshot).toBe('function');
      const refreshed = await record.piSession.refreshSnapshot();
      expect(refreshed.some((command) => command.name === 'plan')).toBe(true);
      expect(record.piSession.getCommands().some((command) => command.name === 'plan')).toBe(true);
    } finally {
      kernel.dispose();
    }
  });
});

describe('node kernel session IPC', () => {
  it('sends sessionFile and sessionID instead of a live SessionManager', () => {
    expect(serializeNodeKernelCreateSessionInput({
      cwd: '/repo',
      sessionManager: {
        getSessionFile: () => '/repo/session.jsonl',
        getSessionId: () => 'ses_existing',
      },
      modelRuntime: { secret: 'drop-me' },
      model: { provider: 'bmlab-grok', id: 'grok-4.6' },
    })).toEqual({
      cwd: '/repo',
      directory: '/repo',
      sessionFile: '/repo/session.jsonl',
      sessionID: 'ses_existing',
      model: { id: 'grok-4.6', provider: 'bmlab-grok' },
    });
  });

  it('create then reopen does not mint a second Untitled jsonl', async () => {
    const home = tempDir('pi-node-home-');
    const cwd = tempDir('pi-node-cwd-');
    const kernel = createPiKernel({
      mock: false,
      useNodeKernel: true,
      nodeBinary: process.execPath,
      home,
      defaultDirectory: cwd,
      versions: { electron: '43.0.0', modules: '88' },
    });
    try {
      await expect(kernel.ready()).resolves.toBe(true);
      const created = await kernel.host.createSession({ directory: cwd, title: 'Keep me' });
      const afterCreate = listActiveSessionFiles(cwd, home);
      expect(afterCreate).toHaveLength(1);
      expect(created.sessionFile).toBeTruthy();

      const reopened = await kernel.host.ensureSession(created.id, cwd);
      expect(reopened.id).toBe(created.id);
      expect(listActiveSessionFiles(cwd, home)).toEqual(afterCreate);
    } finally {
      kernel.dispose();
    }
  });
});

describe('node kernel host-event ownership', () => {
  it('forwards child session and extension UI events, not the parent-owned transcript', () => {
    expect(shouldForwardNodeKernelHostEvent({ type: 'session.created' })).toBe(true);
    expect(shouldForwardNodeKernelHostEvent({ type: 'session.updated' })).toBe(true);
    expect(shouldForwardNodeKernelHostEvent({ type: 'pi.ui.asked' })).toBe(true);
    expect(shouldForwardNodeKernelHostEvent({ type: 'pi.ui.notify' })).toBe(true);
    expect(shouldForwardNodeKernelHostEvent({ type: 'message.updated' })).toBe(false);
    expect(shouldForwardNodeKernelHostEvent({ type: 'message.part.updated' })).toBe(false);
    expect(shouldForwardNodeKernelHostEvent({ type: 'message.part.delta' })).toBe(false);
    expect(shouldForwardNodeKernelHostEvent({ type: 'message.removed' })).toBe(false);
    expect(shouldForwardNodeKernelHostEvent({ type: 'session.status' })).toBe(false);
    expect(shouldForwardNodeKernelHostEvent({ type: 'session.idle' })).toBe(false);
    expect(shouldForwardNodeKernelHostEvent(null)).toBe(false);
  });

  it('one Desktop prompt stays one user turn when the child host also translates Pi user echo', async () => {
    const cwd = tempDir('pi-node-event-cwd-');
    const events = [];
    const publish = (_directory, event) => events.push(event);

    const createEchoSession = () => {
      const listeners = new Set();
      const emit = (event) => {
        for (const listener of Array.from(listeners)) listener(event);
      };
      return {
        sessionId: 'ses_echo',
        isStreaming: false,
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async prompt(text) {
          emit({ type: 'agent_start' });
          emit({ type: 'message_start', message: { role: 'user', id: 'pi_user', content: text } });
          emit({ type: 'message_start', message: { role: 'assistant', id: 'pi_asst', content: [] } });
          emit({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_start', contentIndex: 0 },
          });
          emit({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '先摸清' },
          });
          emit({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: '先摸清' },
          });
          emit({
            type: 'message_end',
            message: { role: 'assistant', id: 'pi_asst', content: [{ type: 'text', text: '先摸清' }] },
          });
          emit({ type: 'agent_end', messages: [], willRetry: false });
          emit({ type: 'agent_settled' });
        },
        async abort() {},
        dispose() { listeners.clear(); },
      };
    };

    const childHost = createPiHost({
      mock: true,
      defaultDirectory: cwd,
      createSession: async () => createEchoSession(),
      onEvent: (directory, event) => {
        if (shouldForwardNodeKernelHostEvent(event)) publish(directory, event);
      },
    });
    const parentHost = createPiHost({
      mock: true,
      defaultDirectory: cwd,
      createSession: async (input) => {
        const record = await childHost.createSession(input);
        return record.piSession;
      },
      onEvent: publish,
    });

    try {
      await parentHost.ready();
      const session = await parentHost.createSession({ directory: cwd, title: 'one send' });
      await parentHost.promptAsync(session.id, {
        messageID: 'msg_optimistic',
        parts: [{ type: 'text', text: '清理我电脑垃圾' }],
      });
      await waitFor(
        () => events,
        (items) => items.some((event) => event.type === 'session.idle'),
      );

      const userIds = events
        .filter((event) => event.type === 'message.updated' && event.properties?.info?.role === 'user')
        .map((event) => event.properties.info.id);
      expect(userIds).toEqual(['msg_optimistic']);

      const textDeltas = events
        .filter((event) => event.type === 'message.part.delta')
        .map((event) => event.properties?.delta);
      expect(textDeltas).toEqual(['先摸清']);
    } finally {
      parentHost.dispose();
      childHost.dispose();
    }
  });
});

describe('mergeRemoteSessionSnapshot', () => {
  it('keeps isStreaming true while a parent prompt is in flight', () => {
    const state = { isStreaming: true, sessionId: 'ses_1' };
    mergeRemoteSessionSnapshot(state, { isStreaming: false, sessionId: 'ses_1' }, { promptInFlight: true });
    expect(state.isStreaming).toBe(true);
  });

  it('allows a snapshot to clear isStreaming when no prompt is in flight', () => {
    const state = { isStreaming: true, sessionId: 'ses_1' };
    mergeRemoteSessionSnapshot(state, { isStreaming: false, sessionId: 'ses_1' }, { promptInFlight: false });
    expect(state.isStreaming).toBe(false);
  });
});
