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
  parseElectronNativeTreeError,
  parseExtensionPackages,
  parseSkippedUserExtensions,
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

describe('skipped user extensions', () => {
  test('keeps one unreadable skip from erasing siblings', () => {
    const skipped = parseSkippedUserExtensions({
      skippedUserExtensions: [
        { source: 'npm:bad-a', tree: 'agent', compilerAbi: '137', nodePath: '/tmp/a.node' },
        null,
        { source: 12 },
        { source: 'npm:bad-b', tree: 'project' },
      ],
    });
    expect(skipped.map((item) => item.source)).toEqual(['npm:bad-a', 'npm:bad-b']);
  });

  test('treats electron-tree sync failure as an error, not a disabled-success snapshot', () => {
    expect(parseElectronNativeTreeError({
      electronNativeTree: { enabled: true, ok: false, error: 'rebuild failed' },
    })).toBe('rebuild failed');
    expect(parseElectronNativeTreeError({
      electronNativeTree: { enabled: false, ok: true },
    })).toBeNull();
  });
});

describe('ExtensionsPage version display', () => {
  test('shows muted current version text and Update, not chips or Up to date', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'ExtensionsPage.tsx'),
      'utf8',
    );
    expect(source).toContain('SETTINGS_VERSION_META_CLASS');
    expect(source).not.toContain('SettingsVersionChips');
    expect(source).not.toContain('versionBits.join');
    expect(source).not.toContain('actions.upToDate');
    expect(source).not.toContain('latestUnknown');
    expect(source).toContain('updateToVersion');
    expect(source).toContain('SETTINGS_ACTION_BUTTON_CLASS');
  });
});
