import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { rebuildIsolatedNativePackageInChild } from './user-extension-electron-rebuild.js';
import { isElectronProcess } from './user-extension-native.js';
import {
  clearLazyNativeCandidates,
  discoverNativePackageCandidates,
  electronRuntimeKey,
  electronTreeRootForNpm,
  isolatedPackageDir,
  isolatedPathForCliFile,
  isNativePackageCandidate,
  isValidElectronCache,
  listLazyNativeCandidates,
  rememberLazyNativeCandidate,
  syncUserExtensionElectronTree,
  wrapPackageManagerWithElectronNativeTree,
} from './user-extension-electron-tree.js';

const tempDirs = [];

afterEach(() => {
  clearLazyNativeCandidates();
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

const writePackage = (npmRoot, name, {
  version = '1.0.0',
  native = false,
  napi = false,
  nodeBytes = 'node-abi',
  extras = {},
} = {}) => {
  const dir = path.join(npmRoot, 'node_modules', name);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, 'package.json'), {
    name,
    version,
    main: 'index.js',
    ...(napi ? { napi: { versions: [3] } } : {}),
    ...extras,
  });
  if (native) {
    writeText(path.join(dir, 'binding.gyp'), '{ "targets": [{ "target_name": "addon" }] }\n');
    writeText(path.join(dir, 'build', 'Release', 'addon.node'), nodeBytes);
  }
  writeText(path.join(dir, 'index.js'), native
    ? `'use strict';\nmodule.exports = require('./build/Release/addon.node');\n`
    : `'use strict';\nmodule.exports = { name: ${JSON.stringify(name)} };\n`);
  return {
    dir,
    nodePath: native ? path.join(dir, 'build', 'Release', 'addon.node') : '',
  };
};

const electronVersions = (modules = '77') => ({
  modules,
  electron: '1.2.3',
});

const mockRebuild = (marker = 'electron-abi') => async (dest) => {
  writeText(path.join(dest, 'build', 'Release', 'addon.node'), marker);
  return { ok: true, method: 'mock' };
};

describe('electron tree directory formula', () => {
  it('uses the current process modules, platform, and arch — not hardcoded versions', () => {
    const versions = { modules: '1001', electron: '9.9.9' };
    expect(electronRuntimeKey({
      versions,
      platform: 'darwin',
      arch: 'arm64',
    })).toBe('electron-1001-darwin-arm64');
    expect(electronTreeRootForNpm('/tmp/agent/npm', {
      versions,
      platform: 'linux',
      arch: 'x64',
    })).toBe(path.join('/tmp/agent', 'npm-electron', 'electron-1001-linux-x64'));
    expect(isolatedPackageDir(
      electronTreeRootForNpm('/tmp/agent/npm', { versions, platform: 'linux', arch: 'x64' }),
      'foo',
      '1.1.0',
    )).toBe(path.join('/tmp/agent/npm-electron/electron-1001-linux-x64', 'foo@1.1.0'));
  });
});

describe('candidate discovery (case 10)', () => {
  it('enters binding.gyp packages, skips pure JS, and isolates the dependency that emits native code', () => {
    const npm = path.join(tempDir('pi-electron-discover-'), 'npm');
    writePackage(npm, 'parent-ext', {
      extras: { dependencies: { 'native-dep': '1.0.0' } },
    });
    writePackage(npm, 'native-dep', { native: true });
    writePackage(npm, 'only-js');

    expect(isNativePackageCandidate(path.join(npm, 'node_modules', 'parent-ext'))).toBe(false);
    expect(isNativePackageCandidate(path.join(npm, 'node_modules', 'only-js'))).toBe(false);
    expect(isNativePackageCandidate(path.join(npm, 'node_modules', 'native-dep'))).toBe(true);

    const found = discoverNativePackageCandidates(npm).map((item) => item.name).sort();
    expect(found).toEqual(['native-dep']);
  });

  it('treats prebuilds and native package.json metadata as candidates', () => {
    const npm = path.join(tempDir('pi-electron-meta-'), 'npm');
    const prebuild = writePackage(npm, 'prebuilt-native', {
      extras: { binary: { module_name: 'addon' } },
    });
    fs.mkdirSync(path.join(prebuild.dir, 'prebuilds', 'linux-x64'), { recursive: true });
    writeText(path.join(prebuild.dir, 'prebuilds', 'linux-x64', 'electron.napi.node'), 'pre');
    writePackage(npm, 'gypfile-meta', {
      extras: { gypfile: true },
    });

    expect(discoverNativePackageCandidates(npm).map((item) => item.name).sort()).toEqual([
      'gypfile-meta',
      'prebuilt-native',
    ]);
  });
});

describe('syncUserExtensionElectronTree', () => {
  it('copies only native candidates into the current electron directory (cases 10–13)', async () => {
    const agentDir = tempDir('pi-electron-agent-');
    const npm = path.join(agentDir, 'npm');
    writePackage(npm, 'native-dep', { native: true, nodeBytes: 'node-abi' });
    writePackage(npm, 'only-js');
    const versions = electronVersions('64');
    const runtime = { versions, platform: 'linux', arch: 'x64' };

    const result = await syncUserExtensionElectronTree({
      agentDir,
      versions,
      platform: 'linux',
      arch: 'x64',
      rebuildPackage: mockRebuild('electron-abi'),
    });

    expect(result.enabled).toBe(true);
    expect(result.isolated.map((item) => item.name)).toEqual(['native-dep']);
    const dest = isolatedPackageDir(
      electronTreeRootForNpm(npm, runtime),
      'native-dep',
      '1.0.0',
    );
    expect(fs.readFileSync(path.join(dest, 'build', 'Release', 'addon.node'), 'utf8')).toBe('electron-abi');
    expect(fs.readFileSync(path.join(npm, 'node_modules', 'native-dep', 'build', 'Release', 'addon.node'), 'utf8'))
      .toBe('node-abi');
    expect(fs.existsSync(path.join(electronTreeRootForNpm(npm, runtime), 'only-js@1.0.0'))).toBe(false);
    expect(isValidElectronCache(dest, { name: 'native-dep', version: '1.0.0' }, runtime)).toBe(true);
    expect(isolatedPathForCliFile(
      path.join(npm, 'node_modules', 'native-dep', 'index.js'),
      { agentDir, ...runtime },
    )).toBe(path.join(dest, 'index.js'));
  });

  it('does not treat an old modules/platform/arch directory as a hit (case 13)', async () => {
    const agentDir = tempDir('pi-electron-abi-dir-');
    const npm = path.join(agentDir, 'npm');
    writePackage(npm, 'native-dep', { native: true });
    await syncUserExtensionElectronTree({
      agentDir,
      versions: electronVersions('11'),
      platform: 'linux',
      arch: 'x64',
      rebuildPackage: mockRebuild('old'),
    });
    const oldRoot = electronTreeRootForNpm(npm, {
      versions: electronVersions('11'),
      platform: 'linux',
      arch: 'x64',
    });
    expect(fs.existsSync(isolatedPackageDir(oldRoot, 'native-dep', '1.0.0'))).toBe(true);

    const next = await syncUserExtensionElectronTree({
      agentDir,
      versions: electronVersions('99'),
      platform: 'linux',
      arch: 'x64',
      rebuildPackage: mockRebuild('new'),
    });
    const newRoot = electronTreeRootForNpm(npm, {
      versions: electronVersions('99'),
      platform: 'linux',
      arch: 'x64',
    });
    expect(next.isolated.map((item) => item.dest)).toEqual([
      isolatedPackageDir(newRoot, 'native-dep', '1.0.0'),
    ]);
    expect(isolatedPathForCliFile(
      path.join(npm, 'node_modules', 'native-dep', 'index.js'),
      { agentDir, versions: electronVersions('99'), platform: 'linux', arch: 'x64' },
    )).toBe(path.join(newRoot, 'native-dep@1.0.0', 'index.js'));
    expect(isolatedPathForCliFile(
      path.join(npm, 'node_modules', 'native-dep', 'index.js'),
      { agentDir, versions: electronVersions('11'), platform: 'linux', arch: 'x64' },
    )).toBe(path.join(oldRoot, 'native-dep@1.0.0', 'index.js'));
    expect(isolatedPathForCliFile(
      path.join(npm, 'node_modules', 'native-dep', 'index.js'),
      { agentDir, versions: electronVersions('99'), platform: 'darwin', arch: 'x64' },
    )).toBe('');
  });

  it('does not reuse foo@1.0.0 for foo@1.1.0 (case 17)', async () => {
    const agentDir = tempDir('pi-electron-upgrade-');
    const npm = path.join(agentDir, 'npm');
    writePackage(npm, 'foo', { native: true, version: '1.0.0' });
    const runtime = { versions: electronVersions('5'), platform: 'linux', arch: 'x64' };
    await syncUserExtensionElectronTree({
      agentDir,
      ...runtime,
      rebuildPackage: mockRebuild('v1'),
    });
    writePackage(npm, 'foo', { native: true, version: '1.1.0', nodeBytes: 'node-v2' });
    await syncUserExtensionElectronTree({
      agentDir,
      ...runtime,
      rebuildPackage: mockRebuild('v2'),
    });
    const root = electronTreeRootForNpm(npm, runtime);
    expect(fs.readFileSync(path.join(root, 'foo@1.0.0', 'build', 'Release', 'addon.node'), 'utf8')).toBe('v1');
    expect(fs.readFileSync(path.join(root, 'foo@1.1.0', 'build', 'Release', 'addon.node'), 'utf8')).toBe('v2');
    expect(isolatedPathForCliFile(
      path.join(npm, 'node_modules', 'foo', 'index.js'),
      { agentDir, ...runtime },
    )).toBe(path.join(root, 'foo@1.1.0', 'index.js'));
  });

  it('skips a valid cache and only processes new candidates (case 14)', async () => {
    const agentDir = tempDir('pi-electron-cache-');
    const npm = path.join(agentDir, 'npm');
    writePackage(npm, 'native-a', { native: true });
    const runtime = { versions: electronVersions('8'), platform: 'linux', arch: 'x64' };
    const rebuilds = [];
    const rebuildPackage = async (dest) => {
      rebuilds.push(dest);
      return mockRebuild('electron-abi')(dest);
    };
    await syncUserExtensionElectronTree({ agentDir, ...runtime, rebuildPackage });
    writePackage(npm, 'native-b', { native: true });
    const second = await syncUserExtensionElectronTree({ agentDir, ...runtime, rebuildPackage });
    expect(second.skipped.map((item) => item.name)).toEqual(['native-a']);
    expect(second.isolated.map((item) => item.name)).toEqual(['native-b']);
    expect(rebuilds).toHaveLength(2);
    expect(fs.readFileSync(path.join(npm, 'node_modules', 'native-a', 'build', 'Release', 'addon.node'), 'utf8'))
      .toBe('node-abi');
  });

  it('falls back without throwing or mutating the CLI tree when rebuild fails (case 15)', async () => {
    const agentDir = tempDir('pi-electron-fail-');
    const npm = path.join(agentDir, 'npm');
    writePackage(npm, 'native-dep', { native: true, nodeBytes: 'leave-me' });
    const result = await syncUserExtensionElectronTree({
      agentDir,
      versions: electronVersions('3'),
      platform: 'linux',
      arch: 'x64',
      rebuildPackage: async () => ({ ok: false, error: 'node-gyp exited 1' }),
    });
    expect(result.failed).toHaveLength(1);
    expect(fs.readFileSync(path.join(npm, 'node_modules', 'native-dep', 'build', 'Release', 'addon.node'), 'utf8'))
      .toBe('leave-me');
    expect(isolatedPathForCliFile(
      path.join(npm, 'node_modules', 'native-dep', 'index.js'),
      { agentDir, versions: electronVersions('3'), platform: 'linux', arch: 'x64' },
    )).toBe('');
  });

  it('is off without Electron so the CLI never reads the electron tree', async () => {
    const agentDir = tempDir('pi-electron-cli-');
    writePackage(path.join(agentDir, 'npm'), 'native-dep', { native: true });
    const result = await syncUserExtensionElectronTree({
      agentDir,
      versions: { modules: '64', electron: '' },
      rebuildPackage: mockRebuild('should-not-run'),
    });
    expect(isElectronProcess({ electron: '' })).toBe(false);
    expect(result).toEqual({ enabled: false, isolated: [], skipped: [], failed: [] });
    expect(fs.existsSync(path.join(agentDir, 'npm-electron'))).toBe(false);
  });

  it('captures a runtime-only native after ABI failure and isolates it on the next sync', async () => {
    const agentDir = tempDir('pi-electron-lazy-');
    const npm = path.join(agentDir, 'npm');
    const dropped = writePackage(npm, 'runtime-native', {
      extras: {},
      nodeBytes: 'node-abi',
    });
    writeText(path.join(dropped.dir, 'build', 'Release', 'addon.node'), 'node-abi');
    rememberLazyNativeCandidate({
      dir: dropped.dir,
      name: 'runtime-native',
      version: '1.0.0',
      treeRoot: npm,
    });
    expect(listLazyNativeCandidates()).toHaveLength(1);
    const runtime = { versions: electronVersions('22'), platform: 'linux', arch: 'x64' };
    const result = await syncUserExtensionElectronTree({
      agentDir,
      ...runtime,
      rebuildPackage: mockRebuild('electron-abi'),
    });
    expect(result.isolated.map((item) => item.name)).toEqual(['runtime-native']);
  });
});

describe('PackageManager install/update wrap (case 14)', () => {
  it('syncs after install and update without wrapping a non-Electron manager', async () => {
    const agentDir = tempDir('pi-electron-pm-');
    writePackage(path.join(agentDir, 'npm'), 'native-dep', { native: true });
    const calls = [];
    const manager = {
      async installAndPersist(source) {
        calls.push(['install', source]);
        return { source };
      },
      async update(source) {
        calls.push(['update', source]);
        return { updated: [source] };
      },
      async resolve() {
        return { extensions: [] };
      },
    };
    const electron = wrapPackageManagerWithElectronNativeTree(manager, {
      agentDir,
      versions: electronVersions('4'),
      platform: 'linux',
      arch: 'x64',
      rebuildPackage: mockRebuild('electron-abi'),
    });
    await electron.installAndPersist('npm:native-dep');
    await electron.update('npm:native-dep');
    expect(calls).toEqual([
      ['install', 'npm:native-dep'],
      ['update', 'npm:native-dep'],
    ]);
    expect(fs.existsSync(path.join(
      agentDir,
      'npm-electron',
      'electron-4-linux-x64',
      'native-dep@1.0.0',
      'index.js',
    ))).toBe(true);

    const cli = wrapPackageManagerWithElectronNativeTree(manager, {
      agentDir,
      versions: { modules: '4', electron: '' },
    });
    expect(cli).toBe(manager);
  });
});

describe('rebuild child process (case 16)', () => {
  it('rebuilds through an async child spawn, not spawnSync', async () => {
    const started = [];
    const spawnImpl = () => {
      const listeners = new Map();
      const child = {
        on(event, fn) {
          listeners.set(event, fn);
          return child;
        },
        send() {
          queueMicrotask(() => listeners.get('message')?.({ ok: true, method: 'child' }));
        },
        kill() {},
      };
      started.push(Date.now());
      return child;
    };
    const pending = rebuildIsolatedNativePackageInChild({
      packageDir: tempDir('pi-electron-child-'),
      versions: { electron: '1.0.0', modules: '7' },
      spawnImpl,
    });
    expect(pending).toBeInstanceOf(Promise);
    expect(started).toHaveLength(1);
    await expect(pending).resolves.toEqual({ ok: true, method: 'child' });
  });
});

describe('macOS notarization follow-up (case 18)', () => {
  it('records disable-library-validation as the signed-app prerequisite, not something this VM can load-test', () => {
    const entitlements = fs.readFileSync(
      path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../../../electron/resources/entitlements.mac.plist',
      ),
      'utf8',
    );
    expect(entitlements).toContain('com.apple.security.cs.disable-library-validation');
  });
});
