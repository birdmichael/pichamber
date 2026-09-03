import { isNativeFilePickerActive } from '@/lib/native-file-picker';

const OPEN_SETTINGS_OVERLAY_SELECTOR = [
  '[data-slot="dropdown-menu-content"][data-open]',
  '[data-slot="select-content"][data-open]',
  '[data-slot="popover-content"][data-open]',
].join(',');

function resolveRoot(root?: ParentNode | null): ParentNode | null {
  if (root) {
    return root;
  }
  if (typeof document === 'undefined') {
    return null;
  }
  return document;
}

export function hasOpenSettingsOverlay(root?: ParentNode | null): boolean {
  return Boolean(resolveRoot(root)?.querySelector(OPEN_SETTINGS_OVERLAY_SELECTOR));
}

function hasNestedSettingsDialog(root?: ParentNode | null): boolean {
  return (resolveRoot(root)?.querySelectorAll('[role="dialog"]').length ?? 0) > 1;
}

export const SETTINGS_ESCAPE_FORM_EVENT = 'settings-escape-form';

export function notifySettingsEscapeForm(root?: ParentNode | null): boolean {
  if (hasOpenSettingsOverlay(root) || hasNestedSettingsDialog(root)) {
    return false;
  }
  const form = resolveRoot(root)?.querySelector('[data-settings-escape-form]');
  if (!form) {
    return false;
  }
  form.dispatchEvent(new Event(SETTINGS_ESCAPE_FORM_EVENT));
  return true;
}

export function hasSettingsEscapeForm(root?: ParentNode | null): boolean {
  return Boolean(resolveRoot(root)?.querySelector('[data-settings-escape-form]'));
}

function hasClosest(target: EventTarget | null): target is EventTarget & { closest: (selector: string) => unknown } {
  return Boolean(target && typeof (target as { closest?: unknown }).closest === 'function');
}

export function isEventInsideSettingsView(target: EventTarget | null): boolean {
  return hasClosest(target) && Boolean(target.closest('[data-settings-view="true"]'));
}

export type SettingsDismissDetails = {
  reason?: string | null;
  event?: { target?: EventTarget | null } | Event | null;
};

function eventTargetFromDetails(details?: SettingsDismissDetails): EventTarget | null {
  const event = details?.event;
  if (!event) {
    return null;
  }
  if ('target' in event) {
    return event.target ?? null;
  }
  return null;
}

/**
 * Keep Settings open for native pickers, nested overlays, in-pane clicks that
 * Base UI mis-reads as outside presses, and form-local Escape.
 */
const SETTINGS_OPEN_OUTSIDE_PRESS_GUARD_MS = 400;
let settingsOpenedAtMs = 0;

/** Call when Settings is opening so the leftover click cannot dismiss it. */
export function markSettingsOpenedFromTrigger(): void {
  settingsOpenedAtMs = Date.now();
}

export function resetSettingsOpenedFromTriggerForTests(): void {
  settingsOpenedAtMs = 0;
}

function isImmediateOutsidePressAfterOpen(): boolean {
  return settingsOpenedAtMs > 0 && (Date.now() - settingsOpenedAtMs) < SETTINGS_OPEN_OUTSIDE_PRESS_GUARD_MS;
}

const SETTINGS_INTENTIONAL_CLOSE_REASONS = new Set(['close-press', 'escape-key']);

export function shouldRenderSettingsWindow(isOpen: boolean, hasMountedOnce: boolean): boolean {
  return isOpen || hasMountedOnce;
}

export function shouldBlockSettingsDismiss(
  nextOpen: boolean,
  details?: SettingsDismissDetails,
): boolean {
  if (nextOpen) {
    return false;
  }
  if (isNativeFilePickerActive()) {
    return true;
  }
  if (hasOpenSettingsOverlay()) {
    return true;
  }

  const reason = details?.reason ?? '';
  if (reason === 'focus-out' || reason === 'none') {
    return true;
  }
  if (reason === 'outside-press' && isEventInsideSettingsView(eventTargetFromDetails(details))) {
    return true;
  }
  // Gear / first-click: pointerdown opens Settings, then the same click can
  // land as outside-press, trigger-press, or imperative-action on the new
  // dialog and would close it again. Keep it open unless the user hit X/Esc.
  if (isImmediateOutsidePressAfterOpen() && !SETTINGS_INTENTIONAL_CLOSE_REASONS.has(reason)) {
    return true;
  }
  if (reason === 'escape-key' && (hasSettingsEscapeForm() || hasNestedSettingsDialog())) {
    return true;
  }
  return false;
}
