import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createPiKernel } from './index.js';
import { resolveKernelName } from './kernel.js';
import { PI_NODE_UNAVAILABLE_CODE, PI_SDK_UNAVAILABLE_CODE } from './node-runtime.js';
import { createNodeKernelClient } from './node-kernel-client.js';

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
});
