import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

import {
  createPiUpgradeUnsupportedError,
  PI_UPGRADE_UNSUPPORTED_CODE,
  resolveNodeRuntimeForPiCli,
  resolvePiUpdateInvocation,
  runPiSelfUpdate,
} from './pi-upgrade.js';

const fakeCli = (script = '/opt/pichamber/node_modules/@earendil-works/pi-coding-agent/dist/cli.js') => ({
  script,
  packageDir: '/opt/pichamber/node_modules/@earendil-works/pi-coding-agent',
});

describe('pi-upgrade', () => {
  it('creates a 403 unsupported-upgrade error for leftover callers', () => {
    expect(createPiUpgradeUnsupportedError()).toMatchObject({
      status: 403,
      code: PI_UPGRADE_UNSUPPORTED_CODE,
      message: expect.stringMatching(/bundled Pi SDK cannot be upgraded/i),
    });
  });

  it('runs the in-process SDK cli.js, not a PATH pi', () => {
    const invocation = resolvePiUpdateInvocation({
      agentDir: '/Users/me/custom-pi',
      env: { PATH: '/usr/bin', HOME: '/Users/me' },
      execPath: '/usr/local/bin/node',
      resolveCli: () => fakeCli(),
    });
    expect(invocation.command).toBe('/usr/local/bin/node');
    expect(invocation.args).toEqual([
      '/opt/pichamber/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
      'update',
    ]);
    expect(invocation.env.PI_CODING_AGENT_DIR).toBe('/Users/me/custom-pi');
    expect(invocation.args[0]).not.toBe('pi');
    expect(invocation.command).not.toBe('pi');
  });

  it('uses ELECTRON_RUN_AS_NODE when the process is Electron', () => {
    const packaged = resolveNodeRuntimeForPiCli({
      execPath: '/Applications/Pichamber.app/Contents/MacOS/Pichamber',
    });
    expect(packaged.command).toContain('Pichamber');
    expect(packaged.extraEnv.ELECTRON_RUN_AS_NODE).toBe('1');

    const electronBin = resolveNodeRuntimeForPiCli({
      execPath: '/usr/lib/electron/electron',
      versions: { electron: '43.3.0' },
    });
    expect(electronBin.command).toBe('/usr/lib/electron/electron');
    expect(electronBin.extraEnv.ELECTRON_RUN_AS_NODE).toBe('1');
  });

  it('rejects when the in-process CLI cannot be resolved', async () => {
    await expect(runPiSelfUpdate({
      agentDir: '/tmp/pi',
      resolveInvocation: () => null,
    })).rejects.toMatchObject({
      status: 503,
      code: 'PI_UPGRADE_CLI_UNAVAILABLE',
    });
  });

  it('resolves after a successful `pi update` spawn', async () => {
    const spawnImpl = (_command, args, options) => {
      expect(args[1]).toBe('update');
      expect(options.windowsHide).toBe(true);
      expect(options.env.PI_CODING_AGENT_DIR).toBe('/tmp/agent');
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => {
        child.stdout.emit('data', 'Pi is already up to date\n');
        child.emit('close', 0, null);
      });
      return child;
    };
    const result = await runPiSelfUpdate({
      agentDir: '/tmp/agent',
      spawnImpl,
      resolveInvocation: () => ({
        command: '/usr/bin/node',
        args: ['/tmp/cli.js', 'update'],
        env: { PI_CODING_AGENT_DIR: '/tmp/agent' },
      }),
    });
    expect(result.ok).toBe(true);
    expect(result.command).toBe('pi update');
  });

  it('surfaces a failed `pi update` exit', async () => {
    const spawnImpl = () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => {
        child.stderr.emit('data', 'npm ERR! network\n');
        child.emit('close', 1, null);
      });
      return child;
    };
    await expect(runPiSelfUpdate({
      spawnImpl,
      resolveInvocation: () => ({
        command: '/usr/bin/node',
        args: ['/tmp/cli.js', 'update'],
        env: {},
      }),
    })).rejects.toMatchObject({
      status: 500,
      message: expect.stringContaining('pi update'),
    });
  });
});
