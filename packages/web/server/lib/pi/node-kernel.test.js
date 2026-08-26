import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { SessionManager, CURRENT_SESSION_VERSION } from '@earendil-works/pi-coding-agent';
import { createPiKernel } from './index.js';
import { resolveKernelName } from './kernel.js';
import { PI_NODE_UNAVAILABLE_CODE, PI_SDK_UNAVAILABLE_CODE, toNodeReadablePath } from './node-runtime.js';
import { createNodeKernelClient, reapPiChromeCdpProcesses, resolveNodeKernelChildScript, serializeNodeKernelCreateSessionInput } from './node-kernel-client.js';
import { bindNodeKernelChildUiContext } from './node-kernel-ui.js';
import { createInMemoryPiSession, sessionDirForCwd } from './pi-host.js';

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
    const kernel = createPiKernel({
      mock: true,
      useNodeKernel: true,
      nodeBinary: path.join(home, 'missing-node'),
      home,
      defaultDirectory: cwd,
      versions: { electron: '43.0.0', modules: '88' },
      env: { PATH: '' },
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
