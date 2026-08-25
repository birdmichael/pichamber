import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PI_NODE_UNAVAILABLE_CODE,
  childPathEnvForNode,
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
