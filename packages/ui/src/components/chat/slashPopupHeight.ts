/**
 * Desktop `/` popup height. Two-line command rows plus the keyboard-hint
 * footer made the old 256px (`max-h-64`) cap show ~3.5 rows and clip the
 * last name. The cap is large enough for a typical list to be scannable;
 * the value is snapped to whole rows so the last visible row stays intact.
 */

export const DESKTOP_SLASH_POPUP_DESIGN_CAP_PX = 640;
export const DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX = 59;
/** Keyboard-hint footer plus the popup 2px border. List padding is inside the scroller, not chrome. */
export const DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX = 36;

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
