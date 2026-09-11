/**
 * Nested Files UI that must win the first Escape before the panel closes.
 *
 * Issue #512 / #712: in-app editor Find/Replace (and Markdown preview find, same
 * layering as #414). Do not add tree context-menu / dialog predicates here;
 * that is issue #517.
 */

export const FILES_FIND_BAR_SELECTOR = '.cm-search, [data-md-preview-find]';

/** Document attribute set while Files editor or Markdown preview find is open. */
export const FILES_FIND_OPEN_ATTR = 'data-files-find-open';

/** Window event: first Esc (or ×) should close the in-app find bar only. */
export const CLOSE_FILES_FIND_EVENT = 'pichamber:close-files-find';

const openFindSurfaces = new Set<string>();

function syncFilesFindOpenAttribute(): void {
  if (typeof document === 'undefined') return;
  if (openFindSurfaces.size > 0) {
    document.documentElement.setAttribute(FILES_FIND_OPEN_ATTR, 'true');
  } else {
    document.documentElement.removeAttribute(FILES_FIND_OPEN_ATTR);
  }
}

function hasClosest(
  target: EventTarget | null,
): target is EventTarget & { closest: (selector: string) => unknown } {
  return Boolean(target && typeof (target as { closest?: unknown }).closest === 'function');
}

export function isFilesFindBarOpen(
  target: EventTarget | null,
  panel: ParentNode | null,
): boolean {
  if (openFindSurfaces.size > 0) {
    return true;
  }
  if (typeof document !== 'undefined' && document.documentElement.hasAttribute(FILES_FIND_OPEN_ATTR)) {
    return true;
  }
  if (hasClosest(target) && Boolean(target.closest(FILES_FIND_BAR_SELECTOR))) {
    return true;
  }
  return Boolean(panel?.querySelector(FILES_FIND_BAR_SELECTOR));
}

/** First Esc closes Find/Replace; a later Esc may close Files. */
export function shouldYieldFilesPanelEscape(
  event: { target: EventTarget | null },
  panel: ParentNode | null,
): boolean {
  return isFilesFindBarOpen(event.target, panel);
}

/**
 * Record whether a named Files find surface is open (editor / markdown-preview).
 * Keeps an in-memory set (works without DOM) and syncs `data-files-find-open`
 * when document is available so Esc yield does not race CodeMirror mount.
 */
export function setFilesFindSurfaceOpen(surfaceId: string, open: boolean): void {
  if (open) openFindSurfaces.add(surfaceId);
  else openFindSurfaces.delete(surfaceId);
  syncFilesFindOpenAttribute();
}

/** Reset open surfaces (tests). */
export function resetFilesFindOpenAttributeForTests(): void {
  openFindSurfaces.clear();
  syncFilesFindOpenAttribute();
}

/** Ask Files/Markdown find UIs to dismiss without closing the panel. */
export function requestCloseFilesFind(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CLOSE_FILES_FIND_EVENT));
}
