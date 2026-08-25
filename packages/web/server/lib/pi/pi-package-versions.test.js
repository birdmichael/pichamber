import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  enrichPiPackageVersions,
  packageHasUpdate,
  parsePiPackageSpec,
} from './pi-package-versions.js';

const tempHomes = [];
afterEach(() => {
  for (const dir of tempHomes.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const makeHome = () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-pkg-versions-'));
  tempHomes.push(home);
  return home;
};

describe('pi-package-versions', () => {
  it('parses npm specs and treats exact versions as pinned', () => {
    expect(parsePiPackageSpec('npm:pi-question-tool')).toEqual({
      kind: 'npm',
      source: 'npm:pi-question-tool',
      name: 'pi-question-tool',
      version: null,
      pinned: false,
    });
    expect(parsePiPackageSpec('npm:pi-question-tool@0.4.1')).toMatchObject({
      name: 'pi-question-tool',
      version: '0.4.1',
      pinned: true,
    });
    expect(parsePiPackageSpec('npm:@narumitw/pi-goal@1.2.3')).toMatchObject({
      name: '@narumitw/pi-goal',
      version: '1.2.3',
      pinned: true,
    });
    expect(parsePiPackageSpec('git:github.com/user/repo')).toMatchObject({ kind: 'git' });
  });

  it('does not invent an update when latest is missing or the spec is pinned', () => {
    expect(packageHasUpdate({
      currentVersion: '1.0.0',
      latestVersion: null,
      kind: 'npm',
    })).toBe(false);
    expect(packageHasUpdate({
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      pinned: true,
      kind: 'npm',
    })).toBe(false);
    expect(packageHasUpdate({
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      kind: 'npm',
    })).toBe(true);
  });

  it('reads the installed package.json and npm latest without walking for discovery', async () => {
    const home = makeHome();
    const installed = path.join(home, '.pi', 'agent', 'npm', 'node_modules', 'pi-question-tool');
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(path.join(installed, 'package.json'), JSON.stringify({
      name: 'pi-question-tool',
      version: '0.4.1',
    }));
    const rows = await enrichPiPackageVersions([
      { name: 'pi-question-tool', path: 'npm:pi-question-tool', source: 'npm', scope: 'user' },
    ], {
      home,
      env: {},
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ version: '0.5.0' }),
      }),
    });
    expect(rows[0]).toMatchObject({
      name: 'pi-question-tool',
      currentVersion: '0.4.1',
      latestVersion: '0.5.0',
      updateAvailable: true,
      pinned: false,
    });
  });

  it('keeps current from a pin and omits latest when the npm check is skipped', async () => {
    const home = makeHome();
    const rows = await enrichPiPackageVersions([
      { name: 'pi-mcp-adapter', path: 'npm:pi-mcp-adapter@2.9.0', source: 'npm', scope: 'user' },
    ], {
      home,
      env: { PI_OFFLINE: '1' },
      fetchImpl: async () => {
        throw new Error('should not fetch');
      },
    });
    expect(rows[0]).toMatchObject({
      currentVersion: '2.9.0',
      latestVersion: null,
      updateAvailable: false,
      pinned: true,
    });
  });

  it('does not invent a latest number when npm fails', async () => {
    const home = makeHome();
    const rows = await enrichPiPackageVersions([
      { name: 'pi-subagents', path: 'npm:pi-subagents', source: 'npm', scope: 'user' },
    ], {
      home,
      env: {},
      fetchImpl: async () => ({ ok: false }),
    });
    expect(rows[0].currentVersion).toBeNull();
    expect(rows[0].latestVersion).toBeNull();
    expect(rows[0].updateAvailable).toBe(false);
  });
});
