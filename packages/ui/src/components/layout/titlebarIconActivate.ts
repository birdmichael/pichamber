/**
 * Titlebar icon buttons sit under hover tooltips and can sit over a sibling
 * Electron drag-region overlay. The first press must run the action instead
 * of only dismissing that hover UI.
 */

export function isPrimaryTitlebarPointer(button: number): boolean {
  return button === 0;
}

/**
 * Activate on primary pointerdown and close hover UI first. Returns true when
 * the following click should be ignored so the action does not run twice.
 */
export function activateTitlebarIconOnPointerDown(options: {
  button: number;
  closeHoverUi: () => void;
  activate: () => void;
}): boolean {
  if (!isPrimaryTitlebarPointer(options.button)) {
    return false;
  }

  options.closeHoverUi();
  options.activate();
  return true;
}
