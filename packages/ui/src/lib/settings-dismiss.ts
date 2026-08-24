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
  if (reason === 'escape-key' && (hasSettingsEscapeForm() || hasNestedSettingsDialog())) {
    return true;
  }
  return false;
}
