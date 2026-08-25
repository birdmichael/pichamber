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

const TOOLTIP_DISMISS_REASONS = new Set(['outside-press', 'trigger-press']);

/**
 * Base UI dismisses a leftover tooltip on the next press and stops that
 * event by default. The press that closed a rail/session tooltip must still
 * reach Settings, Context sources, or any other control under the pointer.
 */
export function shouldAllowTooltipDismissPropagation(options: {
  nextOpen: boolean;
  reason?: string | null;
}): boolean {
  return !options.nextOpen && TOOLTIP_DISMISS_REASONS.has(options.reason ?? '');
}

type TooltipBlurListener = () => void;

const tooltipBlurListeners = new Set<TooltipBlurListener>();
let tooltipWindowBlurBound = false;

function notifyTooltipWindowBlur(): void {
  for (const listener of tooltipBlurListeners) {
    listener();
  }
}

/**
 * Hover tooltips must not survive window deactivation. The leftover popup
 * would otherwise dismiss on the first press after focus and eat that click.
 */
export function subscribeTooltipWindowBlur(listener: TooltipBlurListener): () => void {
  tooltipBlurListeners.add(listener);
  if (!tooltipWindowBlurBound && typeof window !== 'undefined') {
    window.addEventListener('blur', notifyTooltipWindowBlur);
    tooltipWindowBlurBound = true;
  }
  return () => {
    tooltipBlurListeners.delete(listener);
  };
}

export function resetTooltipWindowBlurForTests(): void {
  tooltipBlurListeners.clear();
  tooltipWindowBlurBound = false;
}
