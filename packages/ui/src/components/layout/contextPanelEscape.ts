/**
 * First Esc on Files overlays must not close the Files panel.
 *
 * ContextPanel captures Escape on the panel. Tree context/kebab menus and
 * Create File / Delete dialogs portal out of the aside but stay React
 * children, so that capture still sees Esc. Yield while those overlays are
 * open so they can consume the key. Terminal skip stays in the panel
 * handler. Files editor find-bar Esc is a separate issue.
 */

const OPEN_MENU_SELECTOR = [
  '[data-slot="dropdown-menu-content"][data-open]',
  '[data-slot="select-content"][data-open]',
].join(',');

const OPEN_DIALOG_SELECTOR = [
  '[data-slot="dialog-content"][data-open]',
  '[role="dialog"][data-open]',
].join(',');

const MENU_TARGET_SELECTOR = [
  '[data-slot="dropdown-menu-content"]',
  '[role="menu"]',
  '[role="menuitem"]',
].join(',');

const DIALOG_TARGET_SELECTOR = [
  '[data-slot="dialog-content"]',
  '[role="dialog"]',
].join(',');

type FilesPanelEscapeQuery = {
  target?: EventTarget | null;
  root?: ParentNode | null;
};

function resolveRoot(root?: ParentNode | null): ParentNode | null {
  if (root) {
    return root;
  }
  if (typeof document === 'undefined') {
    return null;
  }
  return document;
}

function hasClosest(
  target: EventTarget | null | undefined,
): target is EventTarget & { closest: (selector: string) => unknown } {
  return Boolean(target && typeof (target as { closest?: unknown }).closest === 'function');
}

function isFilesPanelMenuEventTarget(target: EventTarget | null | undefined): boolean {
  return hasClosest(target) && Boolean(target.closest(MENU_TARGET_SELECTOR));
}

function isFilesPanelDialogEventTarget(target: EventTarget | null | undefined): boolean {
  return hasClosest(target) && Boolean(target.closest(DIALOG_TARGET_SELECTOR));
}

function hasOpenOverlay(root: ParentNode | null, selector: string): boolean {
  return Boolean(root?.querySelector(selector));
}

export function shouldYieldFilesPanelEscape(query: FilesPanelEscapeQuery = {}): boolean {
  const root = resolveRoot(query.root);
  if (isFilesPanelMenuEventTarget(query.target) || hasOpenOverlay(root, OPEN_MENU_SELECTOR)) {
    return true;
  }
  if (isFilesPanelDialogEventTarget(query.target) || hasOpenOverlay(root, OPEN_DIALOG_SELECTOR)) {
    return true;
  }
  return false;
}
