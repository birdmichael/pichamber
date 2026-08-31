import { beforeEach, describe, expect, test } from 'bun:test';

import { useUIStore } from './useUIStore';

const clearOverlays = {
  isCommandPaletteOpen: false,
  isHelpDialogOpen: false,
};

beforeEach(() => {
  useUIStore.setState(clearOverlays);
});

describe('overlay dialog store', () => {
  test('X / onOpenChange(false) closes Keyboard Shortcuts', () => {
    useUIStore.getState().setHelpDialogOpen(true);
    expect(useUIStore.getState().isHelpDialogOpen).toBe(true);

    useUIStore.getState().setHelpDialogOpen(false);
    expect(useUIStore.getState()).toMatchObject(clearOverlays);
  });

  test('command palette does not stack on repeated Ctrl+P', () => {
    useUIStore.getState().setHelpDialogOpen(true);

    useUIStore.getState().toggleCommandPalette();
    expect(useUIStore.getState()).toMatchObject({
      isCommandPaletteOpen: true,
      isHelpDialogOpen: false,
    });

    useUIStore.getState().toggleCommandPalette();
    expect(useUIStore.getState()).toMatchObject(clearOverlays);

    useUIStore.getState().setCommandPaletteOpen(true);
    useUIStore.getState().setCommandPaletteOpen(true);
    expect(useUIStore.getState()).toMatchObject({
      isCommandPaletteOpen: true,
      isHelpDialogOpen: false,
    });
  });
});
