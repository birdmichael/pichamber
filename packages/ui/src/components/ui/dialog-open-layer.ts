import * as React from 'react';

/**
 * Counts mounted dialog layers (Settings window + shared Dialog overlays).
 * Hover tooltips and leftover-overlay pointer-events use this so a nested
 * close cannot punch through to the page while a parent modal is still open.
 */

export const DIALOG_OPEN_CLASS = 'oc-dialog-open';

export const DIALOG_TRIGGER_SCOPE_SELECTOR = [
  '[data-slot="dialog-content"]',
  '[role="dialog"]',
].join(', ');

type DialogLayerListener = () => void;

let openDialogLayerCount = 0;
const listeners = new Set<DialogLayerListener>();

function syncDialogOpenClass(): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.classList.toggle(DIALOG_OPEN_CLASS, openDialogLayerCount > 0);
}

function notifyDialogLayerListeners(): void {
  listeners.forEach((listener) => {
    listener();
  });
}

export function getOpenDialogLayerCount(): number {
  return openDialogLayerCount;
}

export function isDialogLayerOpen(): boolean {
  return openDialogLayerCount > 0;
}

/** True only for the last remaining dialog — leftover overlays may drop pointer-events. */
export function shouldDropPointerEventsOnDialogExit(): boolean {
  return openDialogLayerCount <= 1;
}

export function markDialogLayerMounted(): () => void {
  openDialogLayerCount += 1;
  syncDialogOpenClass();
  notifyDialogLayerListeners();

  return () => {
    openDialogLayerCount = Math.max(0, openDialogLayerCount - 1);
    syncDialogOpenClass();
    notifyDialogLayerListeners();
  };
}

export function subscribeDialogOpenLayer(listener: DialogLayerListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetDialogOpenLayerForTests(): void {
  openDialogLayerCount = 0;
  listeners.clear();
  if (typeof document !== 'undefined') {
    document.documentElement.classList.remove(DIALOG_OPEN_CLASS);
  }
}

export function isElementInsideDialog(target: EventTarget | null | undefined): boolean {
  return target instanceof Element && Boolean(target.closest(DIALOG_TRIGGER_SCOPE_SELECTOR));
}

/** Register this overlay and re-render when another dialog layer mounts or unmounts. */
export function useDialogLayerRegistration(): { dropPointerEventsOnExit: boolean } {
  const [dropPointerEventsOnExit, setDropPointerEventsOnExit] = React.useState(
    () => shouldDropPointerEventsOnDialogExit(),
  );

  React.useLayoutEffect(() => {
    const unmark = markDialogLayerMounted();
    setDropPointerEventsOnExit(shouldDropPointerEventsOnDialogExit());
    const unsubscribe = subscribeDialogOpenLayer(() => {
      setDropPointerEventsOnExit(shouldDropPointerEventsOnDialogExit());
    });
    return () => {
      unsubscribe();
      unmark();
    };
  }, []);

  return { dropPointerEventsOnExit };
}
