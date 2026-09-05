import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LINUX_DEV_SHM_SWITCH,
  LINUX_SHM_RELAUNCH_ENV,
  LINUX_SHM_WARN_FREE_BYTES,
  applyChromiumCommandLineSwitches,
  argvHasChromiumSwitch,
  buildLinuxDevShmRelaunchArgv,
  probeLinuxShmAvailability,
  relaunchWithLinuxDevShmUsageDisabled,
  resolveChromiumCommandLineSwitches,
  shouldRelaunchForLinuxDevShm,
  shouldWarnLowLinuxShm,
} from './chromium-flags.mjs';

test('enables disable-dev-shm-usage on Linux only', () => {
  assert.deepEqual(
    resolveChromiumCommandLineSwitches({ platform: 'linux' }),
    [{ name: LINUX_DEV_SHM_SWITCH }],
  );
  assert.deepEqual(resolveChromiumCommandLineSwitches({ platform: 'darwin' }), []);
  assert.deepEqual(resolveChromiumCommandLineSwitches({ platform: 'win32' }), []);
});

test('applies resolved switches through Electron commandLine', () => {
  const applied = [];
  applyChromiumCommandLineSwitches({
    appendSwitch: (name, value) => applied.push({ name, value }),
  }, { platform: 'linux' });
  assert.deepEqual(applied, [{ name: LINUX_DEV_SHM_SWITCH, value: undefined }]);
});

test('detects the shm switch on argv', () => {
  assert.equal(argvHasChromiumSwitch(['electron', `--${LINUX_DEV_SHM_SWITCH}`, './main.mjs']), true);
  assert.equal(argvHasChromiumSwitch(['electron', './main.mjs', '--disable-gpu']), false);
});

test('relaunches on Linux when the shm switch is missing from argv', () => {
  assert.equal(shouldRelaunchForLinuxDevShm({
    platform: 'linux',
    argv: ['/path/electron', './main.mjs', '--disable-gpu'],
    env: {},
  }), true);
  assert.equal(shouldRelaunchForLinuxDevShm({
    platform: 'linux',
    argv: ['/path/electron', `--${LINUX_DEV_SHM_SWITCH}`, './main.mjs'],
    env: {},
  }), false);
  assert.equal(shouldRelaunchForLinuxDevShm({
    platform: 'linux',
    argv: ['/path/electron', './main.mjs'],
    env: { [LINUX_SHM_RELAUNCH_ENV]: '1' },
  }), false);
  assert.equal(shouldRelaunchForLinuxDevShm({
    platform: 'darwin',
    argv: ['/path/electron', './main.mjs'],
    env: {},
  }), false);
});

test('inserts the shm switch at the front of relaunch argv', () => {
  assert.deepEqual(
    buildLinuxDevShmRelaunchArgv(['/path/electron', './main.mjs', '--disable-gpu']),
    [`--${LINUX_DEV_SHM_SWITCH}`, './main.mjs', '--disable-gpu'],
  );
  assert.deepEqual(
    buildLinuxDevShmRelaunchArgv(['/path/electron', `--${LINUX_DEV_SHM_SWITCH}`, './main.mjs']),
    [`--${LINUX_DEV_SHM_SWITCH}`, './main.mjs'],
  );
});

test('spawns a detached child and exits when a relaunch is required', () => {
  const spawns = [];
  let exitCode;
  const spawned = relaunchWithLinuxDevShmUsageDisabled({
    platform: 'linux',
    argv: ['/path/electron', './main.mjs', '--disable-gpu'],
    env: { KEEP: '1' },
    execPath: '/path/electron',
    spawnImpl: (execPath, args, options) => {
      spawns.push({ execPath, args, options });
      return { unref() {} };
    },
    exitImpl: (code) => {
      exitCode = code;
    },
  });

  assert.equal(spawned, true);
  assert.equal(exitCode, 0);
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].execPath, '/path/electron');
  assert.deepEqual(spawns[0].args, [`--${LINUX_DEV_SHM_SWITCH}`, './main.mjs', '--disable-gpu']);
  assert.equal(spawns[0].options.detached, true);
  assert.equal(spawns[0].options.env[LINUX_SHM_RELAUNCH_ENV], '1');
  assert.equal(spawns[0].options.env.KEEP, '1');
});

test('does not spawn when relaunch is unnecessary', () => {
  let spawnedCalls = 0;
  const spawned = relaunchWithLinuxDevShmUsageDisabled({
    platform: 'linux',
    argv: ['/path/electron', `--${LINUX_DEV_SHM_SWITCH}`, './main.mjs'],
    env: {},
    spawnImpl: () => {
      spawnedCalls += 1;
      return { unref() {} };
    },
    exitImpl: () => {
      throw new Error('should not exit');
    },
  });
  assert.equal(spawned, false);
  assert.equal(spawnedCalls, 0);
});

test('probes Linux shm free space via statfs', () => {
  const availability = probeLinuxShmAvailability({
    platform: 'linux',
    shmPath: '/dev/shm',
    statfsSync: () => ({ bsize: 4096, bavail: 10, blocks: 100 }),
  });
  assert.deepEqual(availability, {
    path: '/dev/shm',
    freeBytes: 40_960,
    totalBytes: 409_600,
  });
  assert.equal(probeLinuxShmAvailability({ platform: 'darwin' }), null);
  assert.equal(probeLinuxShmAvailability({
    platform: 'linux',
    statfsSync: () => {
      throw new Error('missing');
    },
  }), null);
});

test('warns when Linux shm free space is below Chromium floor', () => {
  assert.equal(shouldWarnLowLinuxShm({ freeBytes: LINUX_SHM_WARN_FREE_BYTES - 1 }), true);
  assert.equal(shouldWarnLowLinuxShm({ freeBytes: LINUX_SHM_WARN_FREE_BYTES }), false);
  assert.equal(shouldWarnLowLinuxShm({ freeBytes: Number.NaN }), false);
});
