import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'bun:test';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'useMenuActions.ts'), 'utf8');

test('menu actions listen only on the window CustomEvent (preload bridges IPC)', () => {
  expect(source).toContain("window.addEventListener(MENU_ACTION_EVENT");
  expect(source).not.toContain("listen('openchamber:menu-action'");
  expect(source).not.toContain('DesktopBridgeGlobal');
});

test('menu Command Palette and Shortcuts open idempotently', () => {
  expect(source).toContain("case 'command-palette':");
  expect(source).toContain('setCommandPaletteOpen(true)');
  expect(source).toContain("case 'help-dialog':");
  expect(source).toContain('setHelpDialogOpen(true)');
  expect(source).not.toMatch(/case 'command-palette':\s*\n\s*toggleCommandPalette\(\)/);
});
