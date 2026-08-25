import Module, { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  classifyUserExtensionNativeFailure,
  collectSkippedUserExtensionsFromErrors,
  createUserExtensionNativeSkipStore,
  formatNativeAbiMismatchError,
  isAppOwnedNativePath,
  isElectronProcess,
  isUserNpmTreePath,
  parseNativeAbiMismatch,
  userExtensionSourceFromPath,
  listUserNpmTrees,
  withUserExtensionNativeGuard,
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

const writeNativeFixture = (tree, name) => {
  const nodePath = path.join(tree, 'node_modules', name, 'build', 'Release', 'addon.node');
  fs.mkdirSync(path.dirname(nodePath), { recursive: true });
  fs.writeFileSync(nodePath, Buffer.from('not-a-real-native'));
  fs.writeFileSync(path.join(tree, 'node_modules', name, 'package.json'), `${JSON.stringify({
    name,
    main: 'index.js',
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(tree, 'node_modules', name, 'index.js'), [
    "'use strict';",
    `module.exports = require(${JSON.stringify(nodePath)});`,
    '',
  ].join('\n'));
  return { nodePath, entry: path.join(tree, 'node_modules', name, 'index.js') };
};

describe('parseNativeAbiMismatch', () => {
  it('classifies by error shape with arbitrary unequal NODE_MODULE_VERSION integers', () => {
    const nodePath = '/tmp/agent/npm/node_modules/example/build/Release/addon.node';
    const parsed = parseNativeAbiMismatch(formatNativeAbiMismatchError({
      nodePath,
      compilerAbi: '17',
      loaderAbi: '91',
    }));
    expect(parsed).toEqual({
      nodePath,
      compilerAbi: '17',
      parsedLoaderAbi: '91',
    });
  });

  it('does not treat a missing NODE_MODULE_VERSION sentence as an ABI mismatch', () => {
    expect(parseNativeAbiMismatch(new Error('Cannot find module addon.node'))).toBeNull();
  });
});

describe('user npm trees', () => {
  it('treats agentDir/npm and project .pi/npm the same, and ignores app.asar.unpacked', () => {
    const agentDir = '/home/me/.pi/agent';
    const projectDir = '/work/repo';
    const trees = listUserNpmTrees({ agentDir, projectDir });
    const userNode = path.join(agentDir, 'npm', 'node_modules', 'one', 'build', 'Release', 'a.node');
    const projectNode = path.join(projectDir, '.pi', 'npm', 'node_modules', 'two', 'build', 'Release', 'b.node');
    const appOwned = '/Applications/Pichamber.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node';

    expect(isUserNpmTreePath(userNode, { agentDir, projectDir })).toBe(true);
    expect(isUserNpmTreePath(projectNode, { agentDir, projectDir })).toBe(true);
    expect(isUserNpmTreePath(appOwned, { agentDir, projectDir })).toBe(false);
    expect(isAppOwnedNativePath(appOwned)).toBe(true);
    expect(userExtensionSourceFromPath(userNode, trees)).toBe('npm:one');
    expect(userExtensionSourceFromPath(projectNode, trees)).toBe('npm:two');
  });
});

describe('classifyUserExtensionNativeFailure', () => {
  const agentDir = '/home/me/.pi/agent';
  const projectDir = '/work/repo';
  const versions = { modules: '64', electron: '43.1.0' };

  it('skips only user-tree ABI failures while Electron is present', () => {
    const nodePath = path.join(agentDir, 'npm', 'node_modules', 'ext', 'build', 'Release', 'addon.node');
    const skip = classifyUserExtensionNativeFailure(formatNativeAbiMismatchError({
      nodePath,
      compilerAbi: '11',
      loaderAbi: '64',
    }), { agentDir, projectDir, versions });
    expect(skip).toMatchObject({
      source: 'npm:ext',
      nodePath,
      loaderAbi: '64',
      compilerAbi: '11',
      electronVersion: '43.1.0',
      tree: 'user',
    });
  });

  it('does not classify app.asar.unpacked native failures as skipped user extensions', () => {
    const nodePath = '/opt/Pichamber.app/Contents/Resources/app.asar.unpacked/node_modules/clipboard/build/Release/clip.node';
    expect(classifyUserExtensionNativeFailure(formatNativeAbiMismatchError({
      nodePath,
      compilerAbi: '11',
      loaderAbi: '64',
    }), { agentDir, projectDir, versions })).toBeNull();
  });

  it('is off when process.versions.electron is empty', () => {
    const nodePath = path.join(agentDir, 'npm', 'node_modules', 'ext', 'build', 'Release', 'addon.node');
    expect(isElectronProcess({ modules: '64' })).toBe(false);
    expect(classifyUserExtensionNativeFailure(formatNativeAbiMismatchError({
      nodePath,
      compilerAbi: '11',
      loaderAbi: '64',
    }), { agentDir, projectDir, versions: { modules: '64', electron: '' } })).toBeNull();
  });

  it('collects Pi loader errors that wrap the ABI sentence', () => {
    const nodePath = path.join(projectDir, '.pi', 'npm', 'node_modules', 'local-ext', 'build', 'Release', 'addon.node');
    const skipped = collectSkippedUserExtensionsFromErrors([{
      path: path.join(projectDir, '.pi', 'npm', 'node_modules', 'local-ext', 'index.js'),
      error: `Failed to load extension: ${formatNativeAbiMismatchError({
        nodePath,
        compilerAbi: '5',
        loaderAbi: '64',
      })}`,
    }], { agentDir, projectDir, versions });
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({
      source: 'npm:local-ext',
      nodePath,
      compilerAbi: '5',
      loaderAbi: '64',
      tree: 'project',
    });
  });
});

describe('withUserExtensionNativeGuard', () => {
  it('skips ABI-mismatched user natives and leaves loadable modules alone', async () => {
    const agentDir = tempDir('pi-native-agent-');
    const npm = path.join(agentDir, 'npm');
    const bad = writeNativeFixture(npm, 'bad-native');
    const good = writeNativeFixture(npm, 'good-napi');
    const store = createUserExtensionNativeSkipStore();
    const versions = { modules: '77', electron: '1.2.3' };

    await withUserExtensionNativeGuard({
      agentDir,
      versions,
      store,
      loadModule(request, parent, isMain, originalLoad) {
        const resolved = path.resolve(String(request));
        if (resolved === bad.nodePath) {
          throw new Error(formatNativeAbiMismatchError({
            nodePath: resolved,
            compilerAbi: '4',
            loaderAbi: '77',
          }));
        }
        if (resolved === good.nodePath) {
          return { ok: true };
        }
        return originalLoad.call(this, request, parent, isMain);
      },
    }, () => {
      expect(() => require(bad.entry)).toThrow(/NODE_MODULE_VERSION/);
      expect(require(good.entry)).toEqual({ ok: true });
    });

    expect(store.list()).toEqual([expect.objectContaining({
      source: 'npm:bad-native',
      nodePath: bad.nodePath,
      compilerAbi: '4',
      loaderAbi: '77',
      electronVersion: '1.2.3',
    })]);
  });

  it('does not report app-owned native failures as skipped user extensions', async () => {
    const agentDir = tempDir('pi-native-agent-');
    const appOwned = path.join(
      tempDir('pi-app-unpacked-'),
      'app.asar.unpacked',
      'node_modules',
      'node-pty',
      'build',
      'Release',
      'pty.node',
    );
    fs.mkdirSync(path.dirname(appOwned), { recursive: true });
    fs.writeFileSync(appOwned, Buffer.from('not-a-real-native'));
    const store = createUserExtensionNativeSkipStore();

    await withUserExtensionNativeGuard({
      agentDir,
      versions: { modules: '77', electron: '1.2.3' },
      store,
      loadModule(request) {
        throw new Error(formatNativeAbiMismatchError({
          nodePath: path.resolve(String(request)),
          compilerAbi: '4',
          loaderAbi: '77',
        }));
      },
    }, () => {
      expect(() => require(appOwned)).toThrow(/NODE_MODULE_VERSION/);
    });

    expect(store.list()).toEqual([]);
  });

  it('stays off without Electron so a current-process fixture still loads', async () => {
    const agentDir = tempDir('pi-native-agent-');
    const npm = path.join(agentDir, 'npm');
    const fixture = writeNativeFixture(npm, 'system-node-native');
    const store = createUserExtensionNativeSkipStore();
    const originalLoad = Module._load;
    Module._load = function mockLoad(request, parent, isMain) {
      if (path.resolve(String(request)) === fixture.nodePath) {
        return { system: true };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    try {
      await withUserExtensionNativeGuard({
        agentDir,
        versions: { modules: process.versions.modules, electron: '' },
        store,
      }, () => {
        expect(require(fixture.entry)).toEqual({ system: true });
      });
      expect(store.list()).toEqual([]);
    } finally {
      Module._load = originalLoad;
      delete require.cache[require.resolve(fixture.entry)];
    }
  });

  it('records several bad natives without losing a later good load', async () => {
    const agentDir = tempDir('pi-native-agent-');
    const npm = path.join(agentDir, 'npm');
    const first = writeNativeFixture(npm, 'bad-one');
    const second = writeNativeFixture(npm, 'bad-two');
    const good = writeNativeFixture(npm, 'good-js-dep');
    const store = createUserExtensionNativeSkipStore();

    await withUserExtensionNativeGuard({
      agentDir,
      versions: { modules: '8', electron: '9.9.9' },
      store,
      loadModule(request, parent, isMain, originalLoad) {
        const resolved = path.resolve(String(request));
        if (resolved === first.nodePath || resolved === second.nodePath) {
          throw new Error(formatNativeAbiMismatchError({
            nodePath: resolved,
            compilerAbi: resolved === first.nodePath ? '21' : '22',
            loaderAbi: '8',
          }));
        }
        if (resolved === good.nodePath) return { ok: true };
        return originalLoad.call(this, request, parent, isMain);
      },
    }, () => {
      expect(() => require(first.entry)).toThrow(/NODE_MODULE_VERSION/);
      expect(() => require(second.entry)).toThrow(/NODE_MODULE_VERSION/);
      expect(require(good.entry)).toEqual({ ok: true });
    });

    expect(store.list().map((item) => item.source).sort()).toEqual([
      'npm:bad-one',
      'npm:bad-two',
    ]);
  });
});
