import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  packageDisplayName,
  packageHasUpdate,
  packageUninstallSource,
  packageVersionState,
  packagesWithUpdates,
  parseExtensionPackages,
} from './extensionPackageUpdate';

describe('extensionPackageUpdate', () => {
  test('keeps one failed package from erasing siblings', () => {
    const packages = parseExtensionPackages({
      packages: [
        {
          name: 'pi-question-tool',
          path: 'npm:pi-question-tool',
          source: 'npm',
          scope: 'user',
          currentVersion: '0.4.1',
          latestVersion: '0.5.0',
          updateAvailable: true,
        },
        null,
        { name: 12 },
        {
          name: 'pi-mcp-adapter',
          path: 'npm:pi-mcp-adapter',
          source: 'npm',
          scope: 'user',
          currentVersion: '2.9.0',
          latestVersion: null,
          updateAvailable: false,
        },
      ],
    });
    expect(packages.map((item) => item.name)).toEqual([
      'pi-question-tool',
      'pi-mcp-adapter',
    ]);
    expect(packagesWithUpdates(packages).map((item) => item.name)).toEqual(['pi-question-tool']);
    expect(packageHasUpdate(packages[1])).toBe(false);
  });

  test('does not treat a missing latest as an update', () => {
    const packages = parseExtensionPackages({
      packages: [{
        name: 'pi-subagents',
        path: 'npm:pi-subagents',
        source: 'npm',
        scope: 'user',
        currentVersion: '1.0.0',
        updateAvailable: true,
      }],
    });
    expect(packageHasUpdate(packages[0])).toBe(false);
  });

  test('uninstall uses the configured settings.json source, not a display name', () => {
    const packages = parseExtensionPackages({
      packages: [{
        name: 'pi-question-tool',
        path: 'npm:pi-question-tool',
        source: 'npm',
        scope: 'user',
      }],
    });
    expect(packageUninstallSource(packages[0])).toBe('npm:pi-question-tool');
    expect(packageUninstallSource({
      name: 'local-tool',
      path: '',
      source: './tools/local',
      scope: 'project',
    })).toBe('./tools/local');
    expect(packageDisplayName({
      name: 'pi-question-tool',
      path: 'npm:pi-question-tool',
    })).toBe('pi-question-tool');
  });

  test('treats a known current latest as up to date and a missing npm latest as unknown', () => {
    expect(packageVersionState({
      name: 'pi-question-tool',
      path: 'npm:pi-question-tool',
      source: 'npm',
      scope: 'user',
      currentVersion: '0.1.1',
      latestVersion: '0.1.1',
      updateAvailable: false,
    })).toBe('upToDate');
    expect(packageVersionState({
      name: 'pi-question-tool',
      path: 'npm:pi-question-tool',
      source: 'npm',
      scope: 'user',
      currentVersion: '0.1.1',
      latestVersion: null,
      updateAvailable: false,
    })).toBe('unknown');
    expect(packageVersionState({
      name: 'pi-question-tool',
      path: 'npm:pi-question-tool',
      source: 'npm',
      scope: 'user',
      currentVersion: '0.1.1',
      latestVersion: '0.2.0',
      updateAvailable: true,
    })).toBe('update');
    expect(packageVersionState({
      name: 'local-tool',
      path: './tools/local',
      source: 'local',
      scope: 'project',
      currentVersion: '1.0.0',
      latestVersion: null,
    })).toBe('none');
  });
});

describe('ExtensionsPage version display', () => {
  test('uses version chips instead of a Current · Latest sentence', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'ExtensionsPage.tsx'),
      'utf8',
    );
    expect(source).toContain('SettingsVersionChips');
    expect(source).not.toContain('versionBits.join');
  });
});
