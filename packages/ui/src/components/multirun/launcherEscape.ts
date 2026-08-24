/**
 * Multi-run Esc should dismiss an open picker/popover, not the whole form.
 * The launcher listens on window capture, so it must yield when an overlay
 * is already open and will handle Escape itself.
 *
 * Prefer the in-memory overlay registry (authoritative React state) over DOM
 * sniffing. The model picker also mounts `[data-model-picker-list]` and sets
 * `data-popup-open="true"` on the trigger. Empty-string attributes still count
 * as open; explicit `false` / `0` do not.
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

const hasOpenPopupAttribute = (root: ParentNode): boolean => {
  const nodes = root.querySelectorAll('[data-popup-open]');
  for (const node of nodes) {
    if (!(node instanceof Element)) continue;
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
    || root.querySelector('[data-slot="dropdown-menu-content"]')
    || root.querySelector('[role="listbox"]'),
  );
};
