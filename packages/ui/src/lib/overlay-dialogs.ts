/**
 * Keyboard Shortcuts and the command palette are sibling Base UI dialogs.
 * Both open at once stacks backdrops (double dim) and leftover ending overlays
 * eat the Shortcuts X. Keep at most one of them open.
 */

export type OverlayDialogFlags = {
  isCommandPaletteOpen: boolean;
  isHelpDialogOpen: boolean;
};

export function setHelpDialogOpenState(
  open: boolean,
  state: OverlayDialogFlags,
): OverlayDialogFlags {
  if (!open) {
    return { ...state, isHelpDialogOpen: false };
  }
  return { isHelpDialogOpen: true, isCommandPaletteOpen: false };
}

export function setCommandPaletteOpenState(
  open: boolean,
  state: OverlayDialogFlags,
): OverlayDialogFlags {
  if (!open) {
    return { ...state, isCommandPaletteOpen: false };
  }
  return { isCommandPaletteOpen: true, isHelpDialogOpen: false };
}

export function toggleHelpDialogState(state: OverlayDialogFlags): OverlayDialogFlags {
  return setHelpDialogOpenState(!state.isHelpDialogOpen, state);
}

export function toggleCommandPaletteState(state: OverlayDialogFlags): OverlayDialogFlags {
  return setCommandPaletteOpenState(!state.isCommandPaletteOpen, state);
}
