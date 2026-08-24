/**
 * Multi-run Esc should dismiss an open picker/popover, not the whole form.
 * The launcher listens on window capture, so it must yield when an overlay
 * is already open and will handle Escape itself.
 */
export const isLauncherOverlayOpen = (root: ParentNode | null | undefined = typeof document === 'undefined' ? null : document): boolean => {
  if (!root) return false;
  return Boolean(
    root.querySelector('[data-popup-open]')
    || root.querySelector('[data-slot="select-content"]')
    || root.querySelector('[data-slot="dropdown-menu-content"]')
    || root.querySelector('[role="listbox"]'),
  );
};
