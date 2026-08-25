import {
  isDialogLayerOpen,
  isElementInsideDialog,
} from '@/components/ui/dialog-open-layer';

/**
 * Hover tooltips must not steal the activating press. While a primary mouse
 * pointer is down on the trigger, ignore open requests from hover/focus so
 * the click can run the control's action.
 *
 * They also must not paint above an open modal. Sidebar session hover-cards
 * portal to the document at z-200; if pointer-over leaks through a nested
 * dialog close, those cards would cover Settings. Suppress opens whose
 * trigger is not inside the dialog.
 */
export function shouldSuppressTooltipOpen(options: {
  nextOpen: boolean;
  pointerPressActive: boolean;
  trigger?: EventTarget | null;
}): boolean {
  if (!options.nextOpen) {
    return false;
  }

  if (options.pointerPressActive) {
    return true;
  }

  return isTooltipTriggerBehindModal(options.trigger);
}

export function isTooltipTriggerBehindModal(trigger?: EventTarget | null): boolean {
  if (!isDialogLayerOpen()) {
    return false;
  }

  return !isElementInsideDialog(trigger);
}

export function isPrimaryMouseTooltipPointer(
  pointerType: string,
  button: number,
): boolean {
  return pointerType === 'mouse' && button === 0;
}
