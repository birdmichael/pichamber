import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  setCommandPaletteOpenState,
  setHelpDialogOpenState,
  toggleCommandPaletteState,
  toggleHelpDialogState,
} from './overlay-dialogs';

const closed = { isCommandPaletteOpen: false, isHelpDialogOpen: false };
const helpOpen = { isCommandPaletteOpen: false, isHelpDialogOpen: true };
const paletteOpen = { isCommandPaletteOpen: true, isHelpDialogOpen: false };
const stacked = { isCommandPaletteOpen: true, isHelpDialogOpen: true };

describe('overlay dialogs', () => {
  test('X / onOpenChange(false) closes Keyboard Shortcuts', () => {
    expect(setHelpDialogOpenState(false, helpOpen)).toEqual(closed);
    expect(setHelpDialogOpenState(false, stacked)).toEqual(paletteOpen);
  });

  test('opening Keyboard Shortcuts replaces a stacked command palette', () => {
    expect(setHelpDialogOpenState(true, closed)).toEqual(helpOpen);
    expect(setHelpDialogOpenState(true, paletteOpen)).toEqual(helpOpen);
  });

  test('repeated command-palette toggles do not stack on Shortcuts', () => {
    const first = toggleCommandPaletteState(helpOpen);
    expect(first).toEqual(paletteOpen);

    const second = toggleCommandPaletteState(first);
    expect(second).toEqual(closed);

    const third = toggleCommandPaletteState(second);
    expect(third).toEqual(paletteOpen);

    expect(toggleCommandPaletteState(stacked)).toEqual(helpOpen);
    expect(setCommandPaletteOpenState(true, paletteOpen)).toEqual(paletteOpen);
    expect(setCommandPaletteOpenState(true, helpOpen)).toEqual(paletteOpen);
  });

  test('toggling Shortcuts closed leaves a leftover palette alone', () => {
    expect(toggleHelpDialogState(helpOpen)).toEqual(closed);
    expect(toggleHelpDialogState(closed)).toEqual(helpOpen);
  });
});

describe('overlay dialog wiring', () => {
  const here = dirname(fileURLToPath(import.meta.url));

  test('HelpDialog honors Dialog onOpenChange so X and Esc close it', () => {
    const source = readFileSync(join(here, '../components/ui/HelpDialog.tsx'), 'utf8');
    expect(source).toContain('onOpenChange={handleHelpOpenChange}');
    expect(source).toContain('setHelpDialogOpen(open)');
  });

  test('command palette Dialog onOpenChange uses the exclusive setter', () => {
    const source = readFileSync(join(here, '../components/ui/CommandPalette.tsx'), 'utf8');
    expect(source).toContain('onOpenChange={setCommandPaletteOpen}');
  });
});
