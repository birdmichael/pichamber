import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'bun:test';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'useUIStore.ts'), 'utf8');

test('closing Settings resets settingsPage to home for next gear open (#719)', () => {
  const start = source.indexOf('setSettingsDialogOpen: (open) =>');
  expect(start).toBeGreaterThan(-1);
  const block = source.slice(start, source.indexOf('setNewWorktreeDialogOpen', start));
  expect(block).toContain("isSettingsDialogOpen: false, settingsPage: 'home'");
});
