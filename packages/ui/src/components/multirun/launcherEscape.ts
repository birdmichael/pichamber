/**
 * Multi-run Esc should dismiss an open picker/popover, not the whole form.
 * The launcher listens on window capture, so it must yield when an overlay
 * is already open and will handle Escape itself. Once no overlay is open,
 * the same Esc closes the form (same as Cancel).
 *
 * Prefer the in-memory overlay registry (authoritative React state) over DOM
 * sniffing. Scope DOM checks to the launcher root when provided: ChatView
 * stays mounted (invisible) under the form and keeps a model picker list
 * and Prompt Navigator listbox in the document.
 *
 * Count only actually-open popups. Closed Base UI Select / menu popups stay
 * in the DOM with `data-slot="select-content"` / `dropdown-menu-content`.
 * `[data-model-picker-list]` is also present on the hidden chat picker, so
 * its presence is not an open overlay. Empty-string `data-popup-open` still
 * counts as open; explicit `false` / `0` do not.
 */

const openOverlayIds = new Set<string>();

export const markLauncherOverlay = (id: string, open: boolean): void => {
  if (!id) return;
  if (open) openOverlayIds.add(id);
  else openOverlayIds.delete(id);
};

export const resetLauncherOverlays = (): void => {
  openOverlayIds.clear();
};

const hasGetAttribute = (node: unknown): node is { getAttribute: (name: string) => string | null } => (
  typeof (node as { getAttribute?: unknown })?.getAttribute === 'function'
);

const hasOpenPopupAttribute = (root: ParentNode): boolean => {
  const nodes = root.querySelectorAll('[data-popup-open]');
  for (const node of nodes) {
    if (!hasGetAttribute(node)) continue;
    const value = node.getAttribute('data-popup-open');
    if (value === null) continue;
    if (value === 'false' || value === '0') continue;
    return true;
  }
  return false;
};

export const isLauncherOverlayOpen = (root: ParentNode | null | undefined = typeof document === 'undefined' ? null : document): boolean => {
  if (openOverlayIds.size > 0) return true;
  if (!root) return false;
  return Boolean(
    hasOpenPopupAttribute(root)
    || root.querySelector('[data-launcher-overlay]')
    || root.querySelector('[data-slot="select-content"][data-open]')
    || root.querySelector('[data-slot="dropdown-menu-content"][data-open]'),
  );
};

/** First Esc closes an open overlay; otherwise Esc / Cancel close the form. */
export const shouldCloseLauncherFormOnEscape = (overlayOpen: boolean): boolean => !overlayOpen;
