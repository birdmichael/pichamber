import Module, { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createInMemoryPiSession, createPiHost } from './pi-host.js';
import {
  formatNativeAbiMismatchError,
} from './user-extension-native.js';

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

const writeUserExtension = (tree, name, { native = false, body } = {}) => {
  const dir = path.join(tree, 'node_modules', name);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, 'package.json'), {
    name,
    version: '0.0.0',
    main: 'index.js',
    pi: { extensions: ['./index.js'] },
  });
  const nodePath = path.join(dir, 'build', 'Release', 'addon.node');
  if (native) {
    fs.mkdirSync(path.dirname(nodePath), { recursive: true });
    fs.writeFileSync(nodePath, Buffer.from('not-a-real-native'));
  }
  fs.writeFileSync(path.join(dir, 'index.js'), body || [
    "'use strict';",
    native ? `module.exports = require(${JSON.stringify(nodePath)});` : 'module.exports = { name: ' + JSON.stringify(name) + ' };',
    '',
  ].join('\n'));
  return { dir, entry: path.join(dir, 'index.js'), nodePath: native ? nodePath : '' };
};

const loadConfiguredExtensions = (trees) => {
  const loaded = [];
  const errors = [];
  for (const tree of trees) {
    const nodeModules = path.join(tree, 'node_modules');
    if (!fs.existsSync(nodeModules)) continue;
    for (const name of fs.readdirSync(nodeModules)) {
      const entry = path.join(nodeModules, name, 'index.js');
      if (!fs.existsSync(entry)) continue;
      try {
        loaded.push({ name, value: require(entry) });
      } catch (error) {
        errors.push({ path: entry, error: error?.message || String(error) });
      }
    }
  }
  return { loaded, errors };
};

const extensionCommandNames = (record) => (
  (typeof record?.piSession?.getCommands === 'function' ? record.piSession.getCommands() : [])
    .map((item) => item.name)
    .filter((name) => String(name).startsWith('ext-'))
);

const createNativeHost = ({
  home,
  cwd,
  electron = '43.0.0',
  loaderAbi = '88',
  mismatched = new Map(),
  loadable = new Set(),
  extraRequires = [],
} = {}) => {
  const agentDir = path.join(home, '.pi', 'agent');
  const trees = () => [
    path.join(agentDir, 'npm'),
    path.join(cwd, '.pi', 'npm'),
  ];
  const loadIntoSession = (session) => {
    const result = loadConfiguredExtensions(trees());
    for (const extra of extraRequires) {
      try {
        require(extra);
      } catch {
        // App-owned or other non-user requires must not become user-extension skips.
      }
    }
    session.extensionsResult = result;
    for (const item of result.loaded) {
      session.registerCommand(`ext-${item.name}`, async () => {});
    }
    return result;
  };
  return createPiHost({
    home,
    defaultDirectory: cwd,
    mock: true,
    getProcessVersions: () => (electron
      ? { modules: loaderAbi, electron }
      : { modules: loaderAbi, electron: '' }),
    userExtensionNativeLoadModule(request, parent, isMain, originalLoad) {
      const resolved = path.resolve(String(request));
      if (mismatched.has(resolved)) {
        throw new Error(formatNativeAbiMismatchError({
          nodePath: resolved,
          compilerAbi: mismatched.get(resolved),
          loaderAbi,
        }));
      }
      if (loadable.has(resolved)) {
        return { ok: true, path: resolved };
      }
      return originalLoad.call(this, request, parent, isMain);
    },
    createDirectoryRuntime: async ({ cwd: directory }) => ({ session: null, directory }),
    createSession: async () => {
      const session = createInMemoryPiSession();
      loadIntoSession(session);
      const originalReload = session.reload.bind(session);
      session.reload = async () => {
        loadIntoSession(session);
        return originalReload();
      };
      return session;
    },
  });
};

const expectReady = async (host) => {
  await expect(host.ready()).resolves.toBe(true);
};

describe('P0 user extension native skip on the Pi host', () => {
  it('skips an ABI-mismatched user native, keeps kernel ready, and still loads JS siblings', async () => {
    const home = tempDir('pi-native-host-');
    const cwd = tempDir('pi-native-project-');
    const npm = path.join(home, '.pi', 'agent', 'npm');
    const bad = writeUserExtension(npm, 'bad-native', { native: true });
    writeUserExtension(npm, 'good-js');
    writeJson(path.join(home, '.pi', 'agent', 'settings.json'), {
      packages: ['npm:bad-native', 'npm:good-js'],
    });

    const host = createNativeHost({
      home,
      cwd,
      mismatched: new Map([[bad.nodePath, '13']]),
    });
    await expectReady(host);
    const session = await host.createSession({ directory: cwd });
    await host.promptAsync(session.id, { parts: [{ type: 'text', text: 'hello' }] });

    const skipped = host.listSkippedUserExtensions();
    expect(skipped).toEqual([expect.objectContaining({
      source: 'npm:bad-native',
      nodePath: bad.nodePath,
      compilerAbi: '13',
      loaderAbi: '88',
      electronVersion: '43.0.0',
    })]);
    expect(extensionCommandNames(session)).toContain('ext-good-js');
    expect(extensionCommandNames(session)).not.toContain('ext-bad-native');
    host.dispose();
  });

  it('leaves a pure JS extension unchanged', async () => {
    const home = tempDir('pi-native-host-');
    const cwd = tempDir('pi-native-project-');
    writeUserExtension(path.join(home, '.pi', 'agent', 'npm'), 'only-js');
    const host = createNativeHost({ home, cwd });
    await expectReady(host);
    const session = await host.createSession({ directory: cwd });
    expect(host.listSkippedUserExtensions()).toEqual([]);
    expect(extensionCommandNames(session)).toEqual(['ext-only-js']);
    host.dispose();
  });

  it('does not skip an N-API that the current process can dlopen', async () => {
    const home = tempDir('pi-native-host-');
    const cwd = tempDir('pi-native-project-');
    const good = writeUserExtension(path.join(home, '.pi', 'agent', 'npm'), 'good-napi', { native: true });
    const host = createNativeHost({
      home,
      cwd,
      loadable: new Set([good.nodePath]),
    });
    await expectReady(host);
    await host.createSession({ directory: cwd });
    expect(host.listSkippedUserExtensions()).toEqual([]);
    host.dispose();
  });

  it('does not report app.asar.unpacked native failures as skipped user extensions', async () => {
    const home = tempDir('pi-native-host-');
    const cwd = tempDir('pi-native-project-');
    const unpacked = path.join(
      tempDir('pi-asar-'),
      'app.asar.unpacked',
      'node_modules',
      'node-pty',
      'build',
      'Release',
      'pty.node',
    );
    fs.mkdirSync(path.dirname(unpacked), { recursive: true });
    fs.writeFileSync(unpacked, Buffer.from('not-a-real-native'));
    writeUserExtension(path.join(home, '.pi', 'agent', 'npm'), 'good-js');

    const host = createNativeHost({
      home,
      cwd,
      mismatched: new Map([[unpacked, '13']]),
      extraRequires: [unpacked],
    });
    await expectReady(host);
    await host.createSession({ directory: cwd });
    expect(host.listSkippedUserExtensions()).toEqual([]);
    host.dispose();
  });

  it('does not enable the skip layer when Electron is absent', async () => {
    const home = tempDir('pi-native-host-');
    const cwd = tempDir('pi-native-project-');
    const fixture = writeUserExtension(path.join(home, '.pi', 'agent', 'npm'), 'system-node-native', {
      native: true,
    });
    const originalLoad = Module._load;
    Module._load = function mockLoad(request, parent, isMain) {
      if (path.resolve(String(request)) === fixture.nodePath) {
        return { system: true };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    const host = createNativeHost({ home, cwd, electron: '' });
    try {
      await expectReady(host);
      const session = await host.createSession({ directory: cwd });
      expect(host.listSkippedUserExtensions()).toEqual([]);
      expect(session.piSession.extensionsResult.loaded.map((item) => item.name)).toEqual([
        'system-node-native',
      ]);
    } finally {
      Module._load = originalLoad;
      delete require.cache[require.resolve(fixture.entry)];
      host.dispose();
    }
  });

  it('treats a project .pi npm tree the same as agentDir/npm', async () => {
    const home = tempDir('pi-native-host-');
    const cwd = tempDir('pi-native-project-');
    const projectNpm = path.join(cwd, '.pi', 'npm');
    const bad = writeUserExtension(projectNpm, 'project-native', { native: true });
    writeJson(path.join(cwd, '.pi', 'settings.json'), {
      packages: ['npm:project-native'],
    });
    const host = createNativeHost({
      home,
      cwd,
      mismatched: new Map([[bad.nodePath, '19']]),
    });
    await expectReady(host);
    await host.createSession({ directory: cwd });
    expect(host.listSkippedUserExtensions()).toEqual([expect.objectContaining({
      source: 'npm:project-native',
      nodePath: bad.nodePath,
      compilerAbi: '19',
      tree: 'project',
    })]);
    host.dispose();
  });

  it('skips only the failing natives when several are bad and one extension is good', async () => {
    const home = tempDir('pi-native-host-');
    const cwd = tempDir('pi-native-project-');
    const npm = path.join(home, '.pi', 'agent', 'npm');
    const first = writeUserExtension(npm, 'bad-a', { native: true });
    const second = writeUserExtension(npm, 'bad-b', { native: true });
    writeUserExtension(npm, 'good-js');
    const host = createNativeHost({
      home,
      cwd,
      mismatched: new Map([
        [first.nodePath, '31'],
        [second.nodePath, '32'],
      ]),
    });
    await expectReady(host);
    const session = await host.createSession({ directory: cwd });
    expect(host.listSkippedUserExtensions().map((item) => item.source).sort()).toEqual([
      'npm:bad-a',
      'npm:bad-b',
    ]);
    expect(extensionCommandNames(session)).toEqual(['ext-good-js']);
    host.dispose();
  });

  it('recognizes ABI failure by error shape, not hardcoded numbers', async () => {
    const home = tempDir('pi-native-host-');
    const cwd = tempDir('pi-native-project-');
    const bad = writeUserExtension(path.join(home, '.pi', 'agent', 'npm'), 'shape-native', {
      native: true,
    });
    const host = createNativeHost({
      home,
      cwd,
      loaderAbi: '1001',
      mismatched: new Map([[bad.nodePath, '7']]),
    });
    await expectReady(host);
    await host.createSession({ directory: cwd });
    expect(host.listSkippedUserExtensions()).toEqual([expect.objectContaining({
      compilerAbi: '7',
      loaderAbi: '1001',
    })]);
    host.dispose();
  });

  it('keeps skipping the same bad extension after host.reload without crashing or piling up', async () => {
    const home = tempDir('pi-native-host-');
    const cwd = tempDir('pi-native-project-');
    const bad = writeUserExtension(path.join(home, '.pi', 'agent', 'npm'), 'reload-native', {
      native: true,
    });
    const host = createNativeHost({
      home,
      cwd,
      mismatched: new Map([[bad.nodePath, '41']]),
    });
    await expectReady(host);
    const session = await host.createSession({ directory: cwd });
    expect(host.listSkippedUserExtensions()).toHaveLength(1);

    const reloaded = await host.reload();
    expect(reloaded.reloaded).toBe(true);
    expect(reloaded.kernel).toBe('pi');
    await expectReady(host);
    await host.promptAsync(session.id, { parts: [{ type: 'text', text: 'again' }] });
    expect(host.listSkippedUserExtensions()).toEqual([expect.objectContaining({
      source: 'npm:reload-native',
      compilerAbi: '41',
    })]);
    host.dispose();
  });
});
