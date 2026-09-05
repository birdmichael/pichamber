/**
 * Chromium command-line switches for Desktop.
 *
 * Linux containers and many CI hosts ship a tiny /dev/shm (often 64MB). When
 * free space there drops below Chromium's shared-memory floor, renderers die
 * with reason=crashed / exitCode=5 (SIGTRAP) as soon as a second window opens
 * or session markdown/shiki allocates more discardable memory.
 *
 * `--disable-dev-shm-usage` makes Chromium use /tmp instead. Passing it only via
 * `app.commandLine.appendSwitch` is too late: Chromium's discardable-memory
 * manager already bound to /dev/shm before main finishes evaluating. electron:dev
 * puts the flag on argv; packaged / direct `electron ./main.mjs` launches must
 * re-exec once with the same argv flag before creating windows.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';

export const LINUX_DEV_SHM_SWITCH = 'disable-dev-shm-usage';
export const LINUX_SHM_RELAUNCH_ENV = 'PICHAMBER_LINUX_SHM_RELAUNCHED';
export const LINUX_SHM_WARN_FREE_BYTES = 64 * 1024 * 1024;

/**
 * @param {string[]} argv
 * @param {string} [name]
 */
export const argvHasChromiumSwitch = (argv, name = LINUX_DEV_SHM_SWITCH) => (
  argv.some((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`))
);

/**
 * @param {{ platform?: NodeJS.Platform }} [options]
 * @returns {Array<{ name: string, value?: string }>}
 */
export const resolveChromiumCommandLineSwitches = ({ platform = process.platform } = {}) => {
  const switches = [];
  if (platform === 'linux') {
    switches.push({ name: LINUX_DEV_SHM_SWITCH });
  }
  return switches;
};

/**
 * @param {{ appendSwitch: (name: string, value?: string) => void }} commandLine
 * @param {{ platform?: NodeJS.Platform }} [options]
 */
export const applyChromiumCommandLineSwitches = (commandLine, options = {}) => {
  for (const entry of resolveChromiumCommandLineSwitches(options)) {
    if (entry.value === undefined) {
      commandLine.appendSwitch(entry.name);
    } else {
      commandLine.appendSwitch(entry.name, entry.value);
    }
  }
};

/**
 * @param {{
 *   platform?: NodeJS.Platform,
 *   argv?: string[],
 *   env?: NodeJS.ProcessEnv,
 * }} [options]
 */
export const shouldRelaunchForLinuxDevShm = ({
  platform = process.platform,
  argv = process.argv,
  env = process.env,
} = {}) => (
  platform === 'linux'
  && env[LINUX_SHM_RELAUNCH_ENV] !== '1'
  && !argvHasChromiumSwitch(argv, LINUX_DEV_SHM_SWITCH)
);

/**
 * Insert `--disable-dev-shm-usage` after the Electron executable path.
 *
 * @param {string[]} argv full `process.argv` (`[execPath, ...]`)
 */
export const buildLinuxDevShmRelaunchArgv = (argv) => {
  const args = argv.slice(1);
  if (!argvHasChromiumSwitch(args, LINUX_DEV_SHM_SWITCH)) {
    args.unshift(`--${LINUX_DEV_SHM_SWITCH}`);
  }
  return args;
};

/**
 * Re-exec Electron with `--disable-dev-shm-usage` on argv, then exit this
 * process. Returns true when a child was spawned (caller must stop booting).
 *
 * @param {{
 *   platform?: NodeJS.Platform,
 *   argv?: string[],
 *   env?: NodeJS.ProcessEnv,
 *   execPath?: string,
 *   spawnImpl?: typeof spawn,
 *   exitImpl?: (code?: number) => void,
 * }} [options]
 */
export const relaunchWithLinuxDevShmUsageDisabled = ({
  platform = process.platform,
  argv = process.argv,
  env = process.env,
  execPath = process.execPath,
  spawnImpl = spawn,
  exitImpl = process.exit.bind(process),
} = {}) => {
  if (!shouldRelaunchForLinuxDevShm({ platform, argv, env })) {
    return false;
  }

  const child = spawnImpl(execPath, buildLinuxDevShmRelaunchArgv(argv), {
    env: {
      ...env,
      [LINUX_SHM_RELAUNCH_ENV]: '1',
    },
    stdio: 'inherit',
    detached: true,
  });
  child.unref();
  exitImpl(0);
  return true;
};

/**
 * Best-effort free-space probe for /dev/shm so startup logs explain crashes.
 *
 * @param {{
 *   platform?: NodeJS.Platform,
 *   shmPath?: string,
 *   statfsSync?: (path: string) => { bsize?: number, bavail?: number, bfree?: number, blocks?: number },
 * }} [options]
 * @returns {{ path: string, freeBytes: number, totalBytes: number } | null}
 */
export const probeLinuxShmAvailability = ({
  platform = process.platform,
  shmPath = '/dev/shm',
  statfsSync = typeof fs.statfsSync === 'function' ? fs.statfsSync.bind(fs) : null,
} = {}) => {
  if (platform !== 'linux' || typeof statfsSync !== 'function') return null;
  try {
    const stats = statfsSync(shmPath);
    const blockSize = Number(stats?.bsize) || 0;
    const freeBlocks = Number(stats?.bavail ?? stats?.bfree) || 0;
    const totalBlocks = Number(stats?.blocks) || 0;
    if (!blockSize || !totalBlocks) return null;
    return {
      path: shmPath,
      freeBytes: freeBlocks * blockSize,
      totalBytes: totalBlocks * blockSize,
    };
  } catch {
    return null;
  }
};

/**
 * @param {{ freeBytes?: number, warnBelowBytes?: number }} [options]
 */
export const shouldWarnLowLinuxShm = ({
  freeBytes,
  warnBelowBytes = LINUX_SHM_WARN_FREE_BYTES,
} = {}) => Number.isFinite(freeBytes) && freeBytes < warnBelowBytes;
