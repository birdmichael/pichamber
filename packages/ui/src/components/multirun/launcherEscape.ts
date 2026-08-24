/**
 * Multi-run Esc should dismiss an open picker/popover, not the whole form.
 * The launcher listens on window capture, so it must yield when an overlay
 * is already open and will handle Escape itself. Once no overlay is open,
 * the same Esc closes the form (same as Cancel).
 *
 * Prefer the in-memory overlay registry (authoritative React state) over DOM
 * sniffing. The model picker also mounts `[data-model-picker-list]` and sets
 * `data-popup-open="true"` on the trigger. Empty-string attributes still count
 * as open; explicit `false` / `0` do not.
 *
 * Do not treat a bare `[role="listbox"]` as open: the hidden chat
 * Prompt Navigator rail keeps that role mounted while the launcher is up.
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
    || root.querySelector('[data-model-picker-list]')
    || root.querySelector('[data-slot="select-content"]')
    || root.querySelector('[data-slot="dropdown-menu-content"]'),
  );
};

/** First Esc closes an open overlay; otherwise Esc / Cancel close the form. */
export const shouldCloseLauncherFormOnEscape = (overlayOpen: boolean): boolean => !overlayOpen;
