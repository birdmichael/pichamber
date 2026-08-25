import Module, { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createInMemoryPiSession, createPiHost } from './pi-host.js';
import { createSettingsJsonPackageManager } from './feature-plugins.js';
import { formatNativeAbiMismatchError, isElectronProcess } from './user-extension-native.js';
import { electronTreeRootForNpm } from './user-extension-electron-tree.js';
import { isPiKernelEnabled, resolveKernelName } from './kernel.js';

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

const writeText = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
};

const writeUserExtension = (tree, name, {
  native = false,
  bindingGyp = native,
  version = '1.0.0',
  body,
} = {}) => {
  const dir = path.join(tree, 'node_modules', name);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, 'package.json'), {
    name,
    version,
    main: 'index.js',
    pi: { extensions: ['./index.js'] },
  });
  const nodePath = path.join(dir, 'build', 'Release', 'addon.node');
  if (native) {
    fs.mkdirSync(path.dirname(nodePath), { recursive: true });
    writeText(nodePath, 'node-abi');
  }
  if (bindingGyp) {
    writeText(path.join(dir, 'binding.gyp'), '{ "targets": [{ "target_name": "addon" }] }\n');
  }
  fs.writeFileSync(path.join(dir, 'index.js'), body || [
    "'use strict';",
    native ? "module.exports = require('./build/Release/addon.node');" : `module.exports = { name: ${JSON.stringify(name)} };`,
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
  platform = process.platform,
  arch = process.arch,
  mismatched = new Map(),
  loadable = new Set(),
  rebuildPackage,
} = {}) => {
  const agentDir = path.join(home, '.pi', 'agent');
  const trees = () => [
    path.join(agentDir, 'npm'),
    path.join(cwd, '.pi', 'npm'),
  ];
  const loadIntoSession = (session) => {
    const result = loadConfiguredExtensions(trees());
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
    rebuildUserExtensionNative: rebuildPackage || (async (dest) => {
      writeText(path.join(dest, 'build', 'Release', 'addon.node'), 'electron-abi');
      return { ok: true, method: 'mock' };
    }),
    userExtensionNativeLoadModule(request, parent, isMain, originalLoad) {
      const raw = String(request);
      const resolved = path.isAbsolute(raw)
        ? path.resolve(raw)
        : path.resolve(path.dirname(parent?.filename || parent?.id || '.'), raw);
      if (mismatched.has(resolved)) {
        throw new Error(formatNativeAbiMismatchError({
          nodePath: resolved,
          compilerAbi: mismatched.get(resolved),
          loaderAbi,
        }));
      }
      if (loadable.has(resolved) || resolved.includes(`${path.sep}npm-electron${path.sep}`)) {
        if (resolved.endsWith('.node')) return { ok: true, path: resolved, abi: 'electron' };
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

describe('P1a electron tree on the Pi host', () => {
  it('loads a rebuilt native from the current electron tree and leaves the CLI ABI in place (cases 11–12)', async () => {
    const home = tempDir('pi-electron-host-');
    const cwd = tempDir('pi-electron-project-');
    const npm = path.join(home, '.pi', 'agent', 'npm');
    const native = writeUserExtension(npm, 'native-dep', { native: true });
    writeUserExtension(npm, 'good-js');
    const host = createNativeHost({
      home,
      cwd,
      loaderAbi: '88',
      mismatched: new Map([[native.nodePath, '13']]),
    });
    await expect(host.ready()).resolves.toBe(true);
    const session = await host.createSession({ directory: cwd });
    const destNode = path.join(
      electronTreeRootForNpm(npm, {
        versions: { modules: '88', electron: '43.0.0' },
        platform: process.platform,
        arch: process.arch,
      }),
      'native-dep@1.0.0',
      'build',
      'Release',
      'addon.node',
    );
    expect(fs.readFileSync(native.nodePath, 'utf8')).toBe('node-abi');
    expect(fs.readFileSync(destNode, 'utf8')).toBe('electron-abi');
    expect(host.listSkippedUserExtensions()).toEqual([]);
    expect(extensionCommandNames(session).sort()).toEqual(['ext-good-js', 'ext-native-dep']);
    host.dispose();
  });

  it('falls back to P0 skip when rebuild fails, without throwing or changing the CLI tree (case 15)', async () => {
    const home = tempDir('pi-electron-host-fail-');
    const cwd = tempDir('pi-electron-project-');
    const npm = path.join(home, '.pi', 'agent', 'npm');
    const native = writeUserExtension(npm, 'native-dep', { native: true });
    writeUserExtension(npm, 'good-js');
    const host = createNativeHost({
      home,
      cwd,
      mismatched: new Map([[native.nodePath, '13']]),
      rebuildPackage: async () => ({ ok: false, error: 'no compiler' }),
    });
    await expect(host.ready()).resolves.toBe(true);
    const session = await host.createSession({ directory: cwd });
    expect(host.listSkippedUserExtensions()).toEqual([expect.objectContaining({
      source: 'npm:native-dep',
      compilerAbi: '13',
      loaderAbi: '88',
    })]);
    expect(extensionCommandNames(session)).toEqual(['ext-good-js']);
    expect(fs.readFileSync(native.nodePath, 'utf8')).toBe('node-abi');
    expect(fs.existsSync(path.join(home, '.pi', 'agent', 'npm-electron'))).toBe(true);
    host.dispose();
  });

  it('keeps pure-JS Feature Plugins on the settings.json install path (case 25)', async () => {
    const home = tempDir('pi-electron-plugins-');
    const cwd = tempDir('pi-electron-project-');
    const manager = createSettingsJsonPackageManager({ home });
    await manager.installAndPersist('npm:@narumitw/pi-plan-mode');
    await manager.installAndPersist('npm:pi-mcp-adapter');
    writeUserExtension(path.join(home, '.pi', 'agent', 'npm'), 'pi-plan-mode');
    const host = createNativeHost({ home, cwd });
    await host.ready();
    const session = await host.createSession({ directory: cwd });
    expect(host.listSkippedUserExtensions()).toEqual([]);
    expect(extensionCommandNames(session)).toEqual(['ext-pi-plan-mode']);
    expect(host.getFeaturePlugins().slots.plan.installed).toBe(true);
    host.dispose();
  });

  it('leaves host.reload 409-while-streaming unchanged (case 26)', async () => {
    const home = tempDir('pi-electron-reload-');
    const cwd = tempDir('pi-electron-project-');
    const host = createPiHost({
      home,
      defaultDirectory: cwd,
      mock: true,
      getProcessVersions: () => ({ modules: '88', electron: '43.0.0' }),
      rebuildUserExtensionNative: async () => ({ ok: true }),
      createSession: async () => createInMemoryPiSession({
        chunks: ['one ', 'two'],
        chunkDelayMs: 40,
      }),
    });
    const record = await host.createSession({ directory: cwd });
    const prompt = host.promptAsync(record.id, { parts: [{ type: 'text', text: 'go' }] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const result = await host.reload();
    expect(result).toMatchObject({
      reloaded: true,
      kernel: 'pi',
      interruptedSessionIds: [record.id],
    });
    const compacting = createPiHost({
      home,
      defaultDirectory: cwd,
      mock: true,
      getProcessVersions: () => ({ modules: '88', electron: '43.0.0' }),
      createSession: async () => createInMemoryPiSession({ compacting: true }),
    });
    await compacting.createSession({ directory: cwd });
    await expect(compacting.reload()).rejects.toMatchObject({
      status: 409,
      message: 'Wait for compaction to finish before reloading.',
    });
    await prompt;
    host.dispose();
    compacting.dispose();
  });

  it('does not change the leftover OpenCode kernel flag (case 27)', () => {
    expect(resolveKernelName({})).toBe('pi');
    expect(isPiKernelEnabled({ OPENCHAMBER_KERNEL: 'opencode' })).toBe(false);
    expect(isElectronProcess({ electron: '' })).toBe(false);
  });
});

describe('P1a does not enable on CLI', () => {
  it('does not create npm-electron when Electron is absent', async () => {
    const home = tempDir('pi-electron-cli-host-');
    const cwd = tempDir('pi-electron-project-');
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
      await host.ready();
      await host.createSession({ directory: cwd });
      expect(fs.existsSync(path.join(home, '.pi', 'agent', 'npm-electron'))).toBe(false);
      expect(host.listSkippedUserExtensions()).toEqual([]);
    } finally {
      Module._load = originalLoad;
      delete require.cache[require.resolve(fixture.entry)];
      host.dispose();
    }
  });
});
