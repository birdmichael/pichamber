/**
 * First Esc on nested overlays must not close the context panel (Files,
 * Browser, …).
 *
 * ContextPanel captures Escape on the panel. Tree context/kebab menus and
 * Create File / Delete / Add project dialogs portal out of the aside; with
 * `initialFocus={false}` focus can remain inside Browser so the event target
 * is not inside `[role=dialog]`. Yield while a dialog layer is mounted
 * (`isDialogLayerOpen` / `oc-dialog-open`) or while open menu/dialog
 * selectors match — same idea as Settings `data-settings-escape-form`.
 * Terminal skip stays in the panel handler. Files find-bar Esc is separate.
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

const CONTEXT_PANEL_ESCAPE_FORM_SELECTOR = '[data-context-panel-escape-form]';

function hasContextPanelEscapeForm(root: ParentNode | null): boolean {
  return Boolean(root?.querySelector(CONTEXT_PANEL_ESCAPE_FORM_SELECTOR));
}

function hasOpenDialogLayer(root: ParentNode | null): boolean {
  // Prefer the document dialog-layer class: DirectoryExplorer (Add project)
  // keeps focus in Browser when initialFocus={false}, so target-based checks
  // miss. DialogOverlay toggles `oc-dialog-open` via dialog-open-layer.
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('oc-dialog-open')) {
    return true;
  }
  // Also honor explicit open attrs / open overlay when a test root is passed.
  return hasOpenOverlay(root, OPEN_DIALOG_SELECTOR)
    || hasOpenOverlay(root, '[data-slot="dialog-overlay"][data-open]');
}

export function shouldYieldFilesPanelEscape(query: FilesPanelEscapeQuery = {}): boolean {
  const root = resolveRoot(query.root);
  if (isFilesPanelMenuEventTarget(query.target) || hasOpenOverlay(root, OPEN_MENU_SELECTOR)) {
    return true;
  }
  if (
    isFilesPanelDialogEventTarget(query.target)
    || hasOpenDialogLayer(root)
    || hasContextPanelEscapeForm(root)
  ) {
    return true;
  }
  return false;
}
