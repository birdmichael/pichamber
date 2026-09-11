/**
 * Desktop `/` popup height. Command rows are the name plus up to two wrapped
 * description lines. The old 256px (`max-h-64`) cap showed a clipped last
 * name on shorter one-line-description rows.
 *
 * New-session / empty-session welcome chrome used to sit in a vertically
 * centered block. Opening `/` docked the composer and hid the title + chips
 * in the same turn (#223), which gained slash rows but caused a jarring
 * layout jump (#688). Welcome layout is now stably bottom-docked with the
 * hero reserved in the flex space above the composer, so `/` can measure a
 * tall list without collapsing chrome.
 */

export const DESKTOP_SLASH_POPUP_DESIGN_CAP_PX = 640;
/** Name + up to two wrapped description lines, including `py-2` row padding. */
export const DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX = 78;
/** Keyboard-hint footer plus the 2px popup border. List padding is inside the scroller, not chrome. */
export const DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX = 36;
/** Desktop slash descriptions wrap at word boundaries; two lines fit a typical command. */
export const DESKTOP_SLASH_DESCRIPTION_CLASS = 'typography-meta text-muted-foreground mt-0.5 line-clamp-2 whitespace-normal break-words';
/** CSS fallback when JS has not measured yet. Must not be `max-h-64` (256px). */
export const DESKTOP_SLASH_POPUP_MAX_HEIGHT_CLASS = 'max-h-[min(40rem,calc(100dvh-11rem))]';

/**
 * Desktop welcome (new-session draft or empty session) keeps the composer
 * docked at the bottom so opening `/` does not jump the layout (#688).
 * Hero title + starter chips stay mounted in the reserved space above.
 */
export function shouldDockComposerForDesktopWelcome(options: {
  isMobile: boolean;
  isDesktopExpanded: boolean;
  showDesktopDraftWelcomeChrome: boolean;
}): boolean {
  return options.showDesktopDraftWelcomeChrome
    && !options.isMobile
    && !options.isDesktopExpanded;
}

/** @deprecated Prefer shouldDockComposerForDesktopWelcome — slash no longer toggles dock. */
export function shouldDockComposerForDesktopSlashMenu(options: {
  isMobile: boolean;
  isDesktopExpanded: boolean;
  newSessionDraftOpen: boolean;
  commandAutocompleteOpen: boolean;
  /** When set, docks for any desktop welcome chrome (draft or empty session). */
  showDesktopDraftWelcomeChrome?: boolean;
}): boolean {
  if (typeof options.showDesktopDraftWelcomeChrome === 'boolean') {
    return shouldDockComposerForDesktopWelcome({
      isMobile: options.isMobile,
      isDesktopExpanded: options.isDesktopExpanded,
      showDesktopDraftWelcomeChrome: options.showDesktopDraftWelcomeChrome,
    });
  }
  // Legacy callers: treat an open new-session draft as welcome chrome, ignore `/` open.
  return shouldDockComposerForDesktopWelcome({
    isMobile: options.isMobile,
    isDesktopExpanded: options.isDesktopExpanded,
    showDesktopDraftWelcomeChrome: options.newSessionDraftOpen,
  });
}

/** Never hide welcome chrome for `/` — reserve it so the layout stays stable (#688). */
export function shouldHideNewSessionWelcomeForDesktopSlashMenu(
  _options: Parameters<typeof shouldDockComposerForDesktopSlashMenu>[0],
): boolean {
  return false;
}

export function measureDesktopSlashAvailablePx(options: {
  chatTopPx: number;
  popupBottomPx: number;
  visualTopPx?: number;
  gapPx?: number;
}): number {
  const boundaryTop = Math.max(options.chatTopPx, options.visualTopPx ?? 0);
  return Math.max(120, Math.floor(options.popupBottomPx - boundaryTop - (options.gapPx ?? 8)));
}

export function readOverlayMaxHeight(style?: { maxHeight?: string | number }): number | undefined {
  const value = style?.maxHeight;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

export function snapSlashPopupMaxHeight(options: {
  availablePx: number;
  rowHeightPx: number;
  chromePx: number;
}): number {
  const rowHeightPx = Math.max(1, options.rowHeightPx);
  const chromePx = Math.max(0, options.chromePx);
  const listBudget = Math.max(0, options.availablePx - chromePx);
  const rows = Math.max(1, Math.floor(listBudget / rowHeightPx));
  return chromePx + rows * rowHeightPx;
}

export function resolveDesktopSlashPopupMaxHeight(options: {
  availablePx?: number;
  overlayMaxHeightPx?: number;
  rowHeightPx?: number;
  chromePx?: number;
}): number {
  const rowHeightPx = options.rowHeightPx && options.rowHeightPx > 0
    ? options.rowHeightPx
    : DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX;
  const chromePx = options.chromePx ?? DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX;
  const availablePx = Math.min(
    DESKTOP_SLASH_POPUP_DESIGN_CAP_PX,
    options.availablePx ?? DESKTOP_SLASH_POPUP_DESIGN_CAP_PX,
    options.overlayMaxHeightPx ?? DESKTOP_SLASH_POPUP_DESIGN_CAP_PX,
  );
  return snapSlashPopupMaxHeight({ availablePx, rowHeightPx, chromePx });
}
