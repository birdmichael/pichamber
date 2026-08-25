/**
 * Hover tooltips must not steal the activating press. While a primary mouse
 * pointer is down on the trigger, ignore open requests from hover/focus so
 * the click can run the control's action.
 */
export function shouldSuppressTooltipOpen(options: {
  nextOpen: boolean;
  pointerPressActive: boolean;
}): boolean {
  return options.nextOpen && options.pointerPressActive;
}

export function isPrimaryMouseTooltipPointer(
  pointerType: string,
  button: number,
): boolean {
  return pointerType === 'mouse' && button === 0;
}
