/**
 * Desktop `/` popup height. Two-line command rows plus the keyboard-hint
 * footer made the old 256px (`max-h-64`) cap show ~3.5 rows and clip the
 * last name. A new-session composer is vertically centered, so the space
 * above it is also ~256px until the form docks to the bottom while `/` is
 * open. Docking the whole welcome block is not enough: the title and starter
 * chips stay in that block and steal the list viewport (observed ~5 rows /
 * ~295px on 1280×800). Hide that chrome in the same turn, cancel the
 * new-session `pb-[6vh]` inset, then measure the space above the composer
 * and snap to whole rows so the last visible name stays intact.
 */

export const DESKTOP_SLASH_POPUP_DESIGN_CAP_PX = 640;
export const DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX = 59;
/** Keyboard-hint footer plus the 2px popup border. List padding is inside the scroller, not chrome. */
export const DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX = 36;
/** CSS fallback when JS has not measured yet. Must not be `max-h-64` (256px). */
export const DESKTOP_SLASH_POPUP_MAX_HEIGHT_CLASS = 'max-h-[min(40rem,calc(100dvh-11rem))]';

export function shouldDockComposerForDesktopSlashMenu(options: {
  isMobile: boolean;
  isDesktopExpanded: boolean;
  newSessionDraftOpen: boolean;
  commandAutocompleteOpen: boolean;
}): boolean {
  return options.commandAutocompleteOpen
    && !options.isMobile
    && !options.isDesktopExpanded
    && options.newSessionDraftOpen;
}

/** Same moment as the dock: drop the title and starter chips so they cannot steal list height. */
export function shouldHideNewSessionWelcomeForDesktopSlashMenu(
  options: Parameters<typeof shouldDockComposerForDesktopSlashMenu>[0],
): boolean {
  return shouldDockComposerForDesktopSlashMenu(options);
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
