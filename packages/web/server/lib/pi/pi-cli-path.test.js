import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearPiCliPathCache,
  listPiCliPathCandidates,
  resolvePiCliPath,
} from './pi-cli-path.js';

const tempDirs = [];

const createTempDir = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const writeExecutable = (filePath) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '#!/bin/sh\nexit 0\n');
  if (process.platform !== 'win32') fs.chmodSync(filePath, 0o755);
  return filePath;
};

afterEach(() => {
  clearPiCliPathCache();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('listPiCliPathCandidates', () => {
  it('lists PATH, bun, Homebrew, Hermes, and npm-global pi candidates independently of opencode', () => {
    const home = '/Users/alice';
    const candidates = listPiCliPathCandidates({
      env: { PATH: '/custom/bin' },
      homedir: home,
      platform: 'darwin',
      npmGlobalBins: ['/usr/local/lib/node_modules/.bin'],
    });
    const paths = candidates.map((candidate) => candidate.path);

    expect(paths).toContain('/custom/bin/pi');
    expect(paths).toContain(path.join(home, '.bun', 'bin', 'pi'));
    expect(paths).toContain('/opt/homebrew/bin/pi');
    expect(paths).toContain(path.join(home, '.hermes', 'node', 'bin', 'pi'));
    expect(paths).toContain('/usr/local/lib/node_modules/.bin/pi');
    expect(paths.some((candidate) => candidate.includes('opencode'))).toBe(false);
  });
});

describe('resolvePiCliPath', () => {
  it('resolves an executable named pi from PATH and ignores opencode', () => {
    const pathDir = createTempDir('pichamber-pi-path-');
    const piBinary = writeExecutable(path.join(pathDir, 'pi'));
    writeExecutable(path.join(pathDir, 'opencode'));
    const emptyHome = createTempDir('pichamber-pi-empty-home-');

    const resolved = resolvePiCliPath({
      env: { PATH: pathDir },
      homedir: () => emptyHome,
      platform: process.platform === 'win32' ? 'linux' : process.platform,
      npmGlobalBins: [],
      spawnSync: () => ({ status: 1, stdout: '', stderr: '' }),
      bypassCache: true,
    });

    expect(resolved).toEqual({ path: piBinary, source: 'path' });
  });

  it('prefers PI_BINARY over PATH', () => {
    const pathDir = createTempDir('pichamber-pi-path-env-');
    const explicitDir = createTempDir('pichamber-pi-explicit-');
    writeExecutable(path.join(pathDir, 'pi'));
    const explicit = writeExecutable(path.join(explicitDir, 'pi'));
    const emptyHome = createTempDir('pichamber-pi-empty-home-env-');

    const resolved = resolvePiCliPath({
      env: { PATH: pathDir, PI_BINARY: explicit },
      homedir: () => emptyHome,
      npmGlobalBins: [],
      spawnSync: () => ({ status: 1, stdout: '', stderr: '' }),
      bypassCache: true,
    });

    expect(resolved).toEqual({ path: explicit, source: 'env' });
  });

  it('finds ~/.bun/bin/pi, /opt/homebrew/bin/pi, and ~/.hermes/node/bin/pi fallbacks', () => {
    const home = createTempDir('pichamber-pi-home-');
    const bunPi = writeExecutable(path.join(home, '.bun', 'bin', 'pi'));
    const emptyPath = createTempDir('pichamber-pi-empty-path-');

    const bunResolved = resolvePiCliPath({
      env: { PATH: emptyPath },
      homedir: () => home,
      platform: 'darwin',
      npmGlobalBins: [],
      spawnSync: () => ({ status: 1, stdout: '', stderr: '' }),
      bypassCache: true,
    });
    expect(bunResolved).toEqual({ path: bunPi, source: 'fallback' });

    fs.rmSync(bunPi, { force: true });
    const hermesPi = writeExecutable(path.join(home, '.hermes', 'node', 'bin', 'pi'));
    const hermesResolved = resolvePiCliPath({
      env: { PATH: emptyPath },
      homedir: () => home,
      platform: 'darwin',
      npmGlobalBins: [],
      spawnSync: () => ({ status: 1, stdout: '', stderr: '' }),
      bypassCache: true,
    });
    expect(hermesResolved).toEqual({ path: hermesPi, source: 'fallback' });
  });

  it('resolves /opt/homebrew/bin/pi when that fallback is executable', () => {
    const emptyHome = createTempDir('pichamber-pi-empty-home-brew-');
    const emptyPath = createTempDir('pichamber-pi-empty-path-brew-');

    const resolved = resolvePiCliPath({
      env: { PATH: emptyPath },
      homedir: () => emptyHome,
      platform: 'darwin',
      npmGlobalBins: [],
      isExecutable: (filePath) => filePath === '/opt/homebrew/bin/pi',
      spawnSync: () => ({ status: 1, stdout: '', stderr: '' }),
      bypassCache: true,
    });

    expect(resolved).toEqual({ path: '/opt/homebrew/bin/pi', source: 'fallback' });
  });

  it('resolves npm-global bin candidates without using the OpenCode resolver', () => {
    const npmBin = createTempDir('pichamber-pi-npm-');
    const npmPi = writeExecutable(path.join(npmBin, 'pi'));
    const emptyHome = createTempDir('pichamber-pi-empty-home-npm-');
    const emptyPath = createTempDir('pichamber-pi-empty-path-npm-');

    const resolved = resolvePiCliPath({
      env: { PATH: emptyPath },
      homedir: () => emptyHome,
      platform: 'darwin',
      npmGlobalBins: [npmBin],
      isExecutable: (filePath) => filePath === npmPi,
      spawnSync: () => ({ status: 1, stdout: '', stderr: '' }),
      bypassCache: true,
    });

    expect(resolved).toEqual({ path: npmPi, source: 'npm-global' });
  });

  it('uses login-shell command -v pi when no file candidates exist', () => {
    const emptyHome = createTempDir('pichamber-pi-empty-home-shell-');
    const emptyPath = createTempDir('pichamber-pi-empty-path-shell-');
    const discovered = writeExecutable(path.join(createTempDir('pichamber-pi-shell-'), 'pi'));

    const resolved = resolvePiCliPath({
      env: { PATH: emptyPath, SHELL: '/bin/zsh' },
      homedir: () => emptyHome,
      platform: 'darwin',
      npmGlobalBins: [],
      isExecutable: (filePath) => filePath === '/bin/zsh' || filePath === discovered,
      spawnSync: (command, args) => {
        if (command === '/bin/zsh' && Array.isArray(args) && args.includes('command -v pi')) {
          return { status: 0, stdout: `${discovered}\n`, stderr: '' };
        }
        return { status: 1, stdout: '', stderr: '' };
      },
      bypassCache: true,
    });

    expect(resolved).toEqual({ path: discovered, source: 'shell' });
  });

  it('returns null when no pi binary exists', () => {
    const emptyHome = createTempDir('pichamber-pi-empty-home-none-');
    const emptyPath = createTempDir('pichamber-pi-empty-path-none-');

    const resolved = resolvePiCliPath({
      env: { PATH: emptyPath },
      homedir: () => emptyHome,
      platform: 'darwin',
      npmGlobalBins: [],
      isExecutable: () => false,
      spawnSync: () => ({ status: 1, stdout: '', stderr: '' }),
      bypassCache: true,
    });

    expect(resolved).toBeNull();
  });
});
