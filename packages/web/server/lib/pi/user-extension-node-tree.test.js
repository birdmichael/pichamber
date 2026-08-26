import Module from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { isolatedPackageDir } from './user-extension-electron-tree.js';
import {
  installUserExtensionNodeTreeRemap,
  isolatedNodePathForCliFile,
  isValidNodeCache,
  officialNodeVersionFromProcess,
  pickOfficialNodeVersionForModules,
  nodeRuntimeKey,
  nodeTreeRootForNpm,
  rebuildIsolatedNativePackageForNode,
  resolveOfficialNodeCompileTarget,
  syncUserExtensionNodeTree,
} from './user-extension-node-tree.js';

const tempDirs = [];
const uninstalls = [];

afterEach(() => {
  while (uninstalls.length > 0) {
    uninstalls.pop()?.();
  }
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
  nodeBytes = 'homebrew-abi',
} = {}) => {
  const dir = path.join(npmRoot, 'node_modules', name);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, 'package.json'), {
    name,
    version,
    main: 'index.js',
  });
  if (native) {
    writeText(path.join(dir, 'binding.gyp'), '{ "targets": [{ "target_name": "addon" }] }\n');
    writeText(path.join(dir, 'build', 'Release', 'addon.node'), nodeBytes);
  }
  writeText(path.join(dir, 'index.js'), native
    ? `'use strict';\nmodule.exports = require('./build/Release/addon.node');\n`
    : `'use strict';\nmodule.exports = { name: ${JSON.stringify(name)} };\n`);
  return { dir };
};

describe('bundled Node native tree', () => {
  it('keys the cache by Node modules, platform, and arch', () => {
    expect(nodeRuntimeKey({
      versions: { modules: '147' },
      platform: 'darwin',
      arch: 'arm64',
    })).toBe('node-147-darwin-arm64');
    expect(nodeTreeRootForNpm('/tmp/agent/npm', {
      versions: { modules: '147' },
      platform: 'darwin',
      arch: 'arm64',
    })).toBe(path.join('/tmp/agent', 'npm-node', 'node-147-darwin-arm64'));
  });

  it('isolates a rebuild without mutating the CLI npm tree', async () => {
    const agentDir = tempDir('pi-node-agent-');
    const npm = path.join(agentDir, 'npm');
    writePackage(npm, 'better-sqlite3', { native: true, nodeBytes: 'abi-141' });
    writePackage(npm, 'only-js');
    const versions = { modules: '147' };
    const runtime = { versions, platform: 'darwin', arch: 'arm64' };

    const result = await syncUserExtensionNodeTree({
      agentDir,
      versions,
      platform: 'darwin',
      arch: 'arm64',
      rebuildPackage: async (dest) => {
        writeText(path.join(dest, 'build', 'Release', 'addon.node'), 'abi-147');
        return { ok: true, method: 'mock' };
      },
    });

    expect(result.isolated.map((item) => item.name)).toEqual(['better-sqlite3']);
    const dest = isolatedPackageDir(
      nodeTreeRootForNpm(npm, runtime),
      'better-sqlite3',
      '1.0.0',
    );
    expect(fs.readFileSync(path.join(dest, 'build', 'Release', 'addon.node'), 'utf8')).toBe('abi-147');
    expect(fs.readFileSync(path.join(npm, 'node_modules', 'better-sqlite3', 'build', 'Release', 'addon.node'), 'utf8'))
      .toBe('abi-141');
    expect(isValidNodeCache(dest, { name: 'better-sqlite3', version: '1.0.0' }, runtime)).toBe(true);
    expect(isolatedNodePathForCliFile(
      path.join(npm, 'node_modules', 'better-sqlite3', 'build', 'Release', 'addon.node'),
      { agentDir, ...runtime },
    )).toBe(path.join(dest, 'build', 'Release', 'addon.node'));
    expect(isolatedNodePathForCliFile(
      path.join(npm, 'node_modules', 'better-sqlite3', 'index.js'),
      { agentDir, ...runtime },
    )).toBe('');
  });

  it('does not treat a different Node ABI directory as a hit', async () => {
    const agentDir = tempDir('pi-node-abi-');
    const npm = path.join(agentDir, 'npm');
    writePackage(npm, 'better-sqlite3', { native: true });
    const oldRuntime = { versions: { modules: '141' }, platform: 'darwin', arch: 'arm64' };
    const oldDest = isolatedPackageDir(
      nodeTreeRootForNpm(npm, oldRuntime),
      'better-sqlite3',
      '1.0.0',
    );
    fs.mkdirSync(oldDest, { recursive: true });
    writeJson(path.join(oldDest, 'package.json'), { name: 'better-sqlite3', version: '1.0.0' });
    writeJson(path.join(oldDest, '.pichamber-node.json'), {
      ok: true,
      name: 'better-sqlite3',
      version: '1.0.0',
      runtime: nodeRuntimeKey(oldRuntime),
    });

    const next = { versions: { modules: '147' }, platform: 'darwin', arch: 'arm64' };
    expect(isValidNodeCache(oldDest, { name: 'better-sqlite3', version: '1.0.0' }, next)).toBe(false);
    expect(isolatedNodePathForCliFile(
      path.join(npm, 'node_modules', 'better-sqlite3', 'index.js'),
      { agentDir, ...next },
    )).toBe('');
  });

  it('remaps require() onto the isolated Node rebuild', async () => {
    const agentDir = tempDir('pi-node-remap-');
    const npm = path.join(agentDir, 'npm');
    writePackage(npm, 'better-sqlite3', { native: true, nodeBytes: 'abi-141' });
    const versions = { modules: '147' };
    const runtime = { versions, platform: 'darwin', arch: 'arm64' };
    await syncUserExtensionNodeTree({
      agentDir,
      ...runtime,
      rebuildPackage: async (dest) => {
        writeText(path.join(dest, 'build', 'Release', 'addon.node'), 'abi-147');
        writeText(path.join(dest, 'index.js'), "'use strict';\nmodule.exports = { abi: '147' };\n");
        return { ok: true };
      },
    });
    uninstalls.push(installUserExtensionNodeTreeRemap({ agentDir, ...runtime }));
    const dest = isolatedPackageDir(
      nodeTreeRootForNpm(npm, runtime),
      'better-sqlite3',
      '1.0.0',
    );
    const resolved = Module._resolveFilename(
      path.join(npm, 'node_modules', 'better-sqlite3', 'build', 'Release', 'addon.node'),
      module,
      false,
    );
    expect(resolved).toBe(path.join(dest, 'build', 'Release', 'addon.node'));
  });

  it('rebuilds with PATH npm against official headers when the bundled Node is unofficial', () => {
    const seen = [];
    const result = rebuildIsolatedNativePackageForNode({
      packageDir: '/tmp/isolated',
      nodeBinary: '/app/Resources/node/bin/node',
      nodeHeadersDir: '/tmp/headers/v26.8.0',
      nodeTarget: 'v26.8.0',
      extraBinDirs: ['/tmp/cli/node_modules/.bin'],
      spawnSyncImpl: (command, args, options) => {
        seen.push({
          command,
          args,
          cwd: options.cwd,
          path: options.env.PATH,
          runtime: options.env.npm_config_runtime,
          nodedir: options.env.npm_config_nodedir,
          target: options.env.npm_config_target,
        });
        return { status: 0, stdout: 'ok', stderr: '' };
      },
    });
    expect(result).toEqual({ ok: true, method: 'npm-rebuild' });
    expect(seen[0].command).toBe('npm');
    expect(seen[0].args).toEqual(['rebuild']);
    expect(seen[0].cwd).toBe('/tmp/isolated');
    expect(seen[0].runtime).toBe('node');
    expect(seen[0].nodedir).toBe('/tmp/headers/v26.8.0');
    expect(seen[0].target).toBe('26.8.0');
    expect(seen[0].path.startsWith(`/tmp/isolated/node_modules/.bin${path.delimiter}`)).toBe(true);
    expect(seen[0].path.includes(`/tmp/cli/node_modules/.bin${path.delimiter}`)).toBe(true);
    expect(seen[0].path.includes(`/app/Resources/node/bin${path.delimiter}`)).toBe(true);
  });

  it('maps an unofficial bundled Node onto the public release with the same ABI', async () => {
    expect(officialNodeVersionFromProcess({ node: '26.8.0-alpha.0.0.0' })).toBe('');
    expect(officialNodeVersionFromProcess({ node: '26.8.0' })).toBe('v26.8.0');
    expect(pickOfficialNodeVersionForModules([
      { version: 'v26.8.0-nightly', modules: '147' },
      { version: 'v26.8.0', modules: '147' },
      { version: 'v25.9.0', modules: '141' },
    ], '147')).toBe('v26.8.0');
    await expect(resolveOfficialNodeCompileTarget({
      versions: { node: '26.8.0-alpha.0.0.0', modules: '147' },
      fetchIndex: async () => [{ version: 'v26.8.0', modules: '147' }],
    })).resolves.toEqual({ version: 'v26.8.0', fromProcess: false });
  });

  it('retries a failed isolate that was stamped before official headers existed', async () => {
    const agentDir = tempDir('pi-node-retry-');
    const npm = path.join(agentDir, 'npm');
    writePackage(npm, 'better-sqlite3', { native: true });
    const versions = { modules: '147' };
    const runtime = { versions, platform: 'darwin', arch: 'arm64' };
    const dest = isolatedPackageDir(
      nodeTreeRootForNpm(npm, runtime),
      'better-sqlite3',
      '1.0.0',
    );
    fs.mkdirSync(dest, { recursive: true });
    writeJson(path.join(dest, 'package.json'), { name: 'better-sqlite3', version: '1.0.0' });
    writeJson(path.join(dest, '.pichamber-node.json'), {
      ok: false,
      name: 'better-sqlite3',
      version: '1.0.0',
      runtime: nodeRuntimeKey(runtime),
      error: '404 headers',
    });
    const result = await syncUserExtensionNodeTree({
      agentDir,
      ...runtime,
      rebuildPackage: async () => ({ ok: true, method: 'retry' }),
    });
    expect(result.isolated.map((item) => item.name)).toEqual(['better-sqlite3']);
    expect(result.failed).toEqual([]);
  });
});
