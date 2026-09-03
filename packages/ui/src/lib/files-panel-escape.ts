/**
 * Nested Files UI that must win the first Escape before the panel closes.
 *
 * Issue #512: in-app editor Find/Replace (and Markdown preview find, same
 * layering as #414). Do not add tree context-menu / dialog predicates here;
 * that is issue #517.
 */

export const FILES_FIND_BAR_SELECTOR = '.cm-search, [data-md-preview-find]';

function hasClosest(
  target: EventTarget | null,
): target is EventTarget & { closest: (selector: string) => unknown } {
  return Boolean(target && typeof (target as { closest?: unknown }).closest === 'function');
}

export function isFilesFindBarOpen(
  target: EventTarget | null,
  panel: ParentNode | null,
): boolean {
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
