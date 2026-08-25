import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  PI_NODE_UNAVAILABLE_CODE,
  PI_SDK_PACKAGE,
  PI_SDK_UNAVAILABLE_CODE,
  childPathEnvForNode,
  describeNodeKernelFailure,
  isSdkHelloReady,
  resolveInstalledPiSdkInfo,
  resolvePiNodeRuntime,
  shouldUseNodeKernel,
  toNodeReadablePath,
} from './node-runtime.js';
import { resolveKernelName } from './kernel.js';

describe('shouldUseNodeKernel', () => {
  it('defaults to the Node child on Electron and stays in-process otherwise', () => {
    expect(shouldUseNodeKernel({ versions: { electron: '43.0.0' } })).toBe(true);
    expect(shouldUseNodeKernel({ versions: { electron: '' } })).toBe(false);
    expect(shouldUseNodeKernel({ versions: { electron: '43.0.0' }, mock: true })).toBe(false);
    expect(shouldUseNodeKernel({
      versions: { electron: '43.0.0' },
      mock: true,
      useNodeKernel: true,
    })).toBe(true);
  });

  it('can force or disable the Node child without touching the leftover OpenCode kernel', () => {
    expect(shouldUseNodeKernel({
      env: { OPENCHAMBER_PI_NODE_KERNEL: '1' },
      versions: {},
    })).toBe(true);
    expect(shouldUseNodeKernel({
      env: { OPENCHAMBER_PI_NODE_KERNEL: '0' },
      versions: { electron: '43.0.0' },
    })).toBe(false);
    expect(resolveKernelName({ OPENCHAMBER_KERNEL: 'opencode' })).toBe('opencode');
    expect(shouldUseNodeKernel({
      env: { OPENCHAMBER_KERNEL: 'opencode' },
      versions: { electron: '43.0.0' },
    })).toBe(true);
  });
});

describe('resolvePiNodeRuntime', () => {
  it('prefers an override Node binary and rejects PATH pi', () => {
    const resolved = resolvePiNodeRuntime({
      nodeBinary: process.execPath,
      versions: { electron: '43.0.0' },
      env: { PATH: `/tmp/decoy-pi${path.delimiter}${process.env.PATH || ''}` },
    });
    expect(resolved).toMatchObject({ ok: true, source: 'override', command: process.execPath });
    expect(path.basename(resolved.command)).toMatch(/^node(?:\.exe)?$/);

    const rejected = resolvePiNodeRuntime({
      nodeBinary: '/usr/local/bin/pi',
      versions: { electron: '43.0.0' },
      env: {},
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.code).toBe(PI_NODE_UNAVAILABLE_CODE);
    expect(rejected.message).toMatch(/Node\.js binary, not pi/);
  });

  it('does not treat the Electron execPath as Node', () => {
    const resolved = resolvePiNodeRuntime({
      execPath: '/Applications/Pichamber.app/Contents/MacOS/Pichamber',
      versions: { electron: '43.0.0' },
      env: { PATH: '' },
      resourcesPath: '/missing-resources',
    });
    expect(resolved.ok).toBe(false);
    expect(resolved.recovery).toMatch(/PICHAMBER_NODE_BINARY/);
  });

  it('prepends the loader Node onto PATH so install uses the same binary', () => {
    const next = childPathEnvForNode('/opt/node/bin/node', { PATH: '/usr/bin' });
    expect(next.startsWith(`/opt/node/bin${path.delimiter}`)).toBe(true);
  });

  it('prefers bundled Node over PATH Node on Desktop', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-bundled-node-'));
    const bundled = path.join(root, 'node', 'bin', 'node');
    fs.mkdirSync(path.dirname(bundled), { recursive: true });
    fs.writeFileSync(bundled, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(bundled, 0o755);
    const resolved = resolvePiNodeRuntime({
      versions: { electron: '43.0.0' },
      env: {
        PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}`,
        PICHAMBER_BUNDLED_NODE: bundled,
      },
      resourcesPath: path.join(root),
    });
    expect(resolved).toMatchObject({ ok: true, source: 'bundled', command: path.resolve(bundled) });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('treats an empty SDK hello as not ready', () => {
    expect(isSdkHelloReady({
      sdk: { package: '@earendil-works/pi-coding-agent', version: '', packagePath: '' },
    })).toBe(false);
    expect(isSdkHelloReady({
      sdk: {
        package: '@earendil-works/pi-coding-agent',
        version: '0.84.2',
        packagePath: '/app/node_modules/@earendil-works/pi-coding-agent/package.json',
      },
    })).toBe(true);
  });

  it('resolves an ESM-only package that has exports but no CJS main', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-esm-sdk-'));
    const packageName = PI_SDK_PACKAGE;
    const pkgRoot = path.join(root, 'node_modules', packageName);
    const entry = path.join(pkgRoot, 'index.js');
    fs.mkdirSync(pkgRoot, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ type: 'module' })}\n`);
    fs.writeFileSync(path.join(pkgRoot, 'package.json'), `${JSON.stringify({
      name: packageName,
      version: '9.9.9-esm-test',
      type: 'module',
      exports: { '.': './index.js' },
    }, null, 2)}\n`);
    fs.writeFileSync(entry, 'export const AgentSession = class {};\n');

    const req = createRequire(path.join(root, 'package.json'));
    expect(() => req.resolve(packageName)).toThrow(/exports/i);

    const info = await resolveInstalledPiSdkInfo({
      packageName,
      importImpl: async () => import(pathToFileURL(entry).href),
      resolveImpl: () => pathToFileURL(entry).href,
    });
    expect(info.error).toBeUndefined();
    expect(info.version).toBe('9.9.9-esm-test');
    expect(info.packagePath).toBe(path.join(pkgRoot, 'package.json'));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('fail-closes when import() cannot load the SDK', async () => {
    const info = await resolveInstalledPiSdkInfo({
      importImpl: async () => {
        throw new Error('webidl.util.markAsUncloneable is not a function');
      },
      resolveImpl: () => {
        throw new Error('require.resolve must not run after import() failure');
      },
    });
    expect(info.version).toBe('');
    expect(info.packagePath).toBe('');
    expect(info.error).toMatch(/markAsUncloneable/);
  });

  it('does not describe an SDK failure as missing Node.js', () => {
    const failure = describeNodeKernelFailure({
      ok: true,
      command: '/tmp/pichamber-node22/bin/node',
      source: 'override',
      hello: {
        sdk: {
          package: PI_SDK_PACKAGE,
          version: '',
          packagePath: '',
          error: 'No "exports" main defined',
        },
      },
    });
    expect(failure.code).toBe(PI_SDK_UNAVAILABLE_CODE);
    expect(failure.message).toMatch(/exports/);
    expect(failure.message).not.toMatch(/Node\.js was not found/);
    expect(failure.recovery).not.toMatch(/Node\.js was not found/);
    expect(describeNodeKernelFailure({
      ok: false,
      message: 'Desktop could not find a Node.js binary to load user Pi extensions.',
      recovery: 'Install a Node.js that can load the app Pi SDK',
    }).message).not.toBe('Node.js was not found.');
  });

  it('rewrites app.asar paths so a real Node can read unpacked sources', () => {
    const packed = `/app/Pichamber.app/Contents/Resources/app.asar/node_modules/@pichamber/web/server/lib/pi/node-kernel-child.js`;
    expect(toNodeReadablePath(packed)).toContain(`${path.sep}app.asar.unpacked${path.sep}`);
    expect(toNodeReadablePath(packed)).not.toContain(`${path.sep}app.asar${path.sep}`);
  });
});

describe('missing Node recovery', () => {
  it('does not invent a half-up kernel command', () => {
    const resolved = resolvePiNodeRuntime({
      nodeBinary: path.join(os.tmpdir(), `missing-node-${Date.now()}`),
      versions: { electron: '43.0.0' },
      env: { PATH: '' },
    });
    expect(resolved.ok).toBe(false);
    expect(fs.existsSync(resolved.command || '')).toBe(false);
    expect(resolved.recovery).toMatch(/reload Pi/);
  });
});
