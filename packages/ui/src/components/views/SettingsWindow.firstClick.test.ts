import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const viewsDir = dirname(fileURLToPath(import.meta.url));
const settingsWindowSource = readFileSync(join(viewsDir, 'SettingsWindow.tsx'), 'utf8');
const mainLayoutSource = readFileSync(
  join(viewsDir, '../layout/MainLayout.tsx'),
  'utf8',
);

describe('sidebar Settings gear first click', () => {
  test('MainLayout statically imports SettingsWindow instead of lazy-loading the dialog shell', () => {
    expect(mainLayoutSource).toMatch(
      /import\s*\{\s*SettingsWindow\s*\}\s*from\s*'@\/components\/views\/SettingsWindow'/,
    );
    expect(mainLayoutSource).not.toMatch(/const SettingsWindow = lazyWithChunkRecovery/);
    expect(mainLayoutSource).not.toMatch(/lazyWithChunkRecovery\(\(\)\s*=>\s*import\('@\/components\/views\/SettingsWindow'/);
    expect(mainLayoutSource).toContain('<SettingsWindow');
    expect(mainLayoutSource).toContain('open={isSettingsDialogOpen}');
    expect(mainLayoutSource).not.toContain('settingsWindowShouldRender');
    expect(mainLayoutSource).not.toMatch(/<React\.Suspense[^>]*>\s*<SettingsWindow/);
  });

  test('SettingsWindow keeps Dialog.Root mounted when closed and lazy-loads SettingsView', () => {
    expect(settingsWindowSource).toMatch(
      /lazyWithChunkRecovery\(\(\)\s*=>\s*\n?\s*import\('\.\/SettingsView'\)/,
    );
    expect(settingsWindowSource).not.toMatch(/import\s*\{\s*SettingsView\s*\}\s*from\s*'\.\/SettingsView'/);

    const dialogRootIndex = settingsWindowSource.indexOf('<Dialog.Root');
    const settingsViewIndex = settingsWindowSource.indexOf('<SettingsView');
    const openGateIndex = settingsWindowSource.indexOf('{open ?');
    expect(dialogRootIndex).toBeGreaterThan(0);
    expect(openGateIndex).toBeGreaterThan(dialogRootIndex);
    expect(settingsViewIndex).toBeGreaterThan(openGateIndex);
    expect(settingsWindowSource).not.toMatch(/if\s*\(\s*!open\s*\)\s*\{?\s*return\s+null/);
  });
});
