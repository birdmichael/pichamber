import { describe, expect, test } from 'bun:test';
import {
  DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX,
  DESKTOP_SLASH_POPUP_DESIGN_CAP_PX,
  DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX,
  readOverlayMaxHeight,
  resolveDesktopSlashPopupMaxHeight,
  snapSlashPopupMaxHeight,
} from '../slashPopupHeight';

describe('snapSlashPopupMaxHeight', () => {
  test('the old 256px cap leaves a clipped remainder on described rows', () => {
    const height = snapSlashPopupMaxHeight({
      availablePx: 256,
      rowHeightPx: DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX,
      chromePx: DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX,
    });
    expect(Math.floor((256 - DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX) / DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX)).toBe(3);
    expect((height - DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX) % DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX).toBe(0);
    expect(Math.floor((height - DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX) / DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX)).toBe(3);
  });

  test('always lands on a whole number of rows', () => {
    const height = snapSlashPopupMaxHeight({
      availablePx: 500,
      rowHeightPx: 59,
      chromePx: 36,
    });
    expect((height - 36) % 59).toBe(0);
    expect(height).toBeLessThanOrEqual(500);
    expect(Math.floor((height - 36) / 59)).toBeGreaterThanOrEqual(1);
  });

  test('keeps at least one row when the window is short', () => {
    expect(snapSlashPopupMaxHeight({
      availablePx: 80,
      rowHeightPx: 59,
      chromePx: 36,
    })).toBe(95);
  });
});

describe('resolveDesktopSlashPopupMaxHeight', () => {
  test('the design cap fits at least eight full described rows', () => {
    const height = resolveDesktopSlashPopupMaxHeight({
      rowHeightPx: DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX,
      chromePx: DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX,
    });
    const rows = Math.floor((height - DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX) / DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX);
    expect(rows).toBeGreaterThanOrEqual(8);
    expect((height - DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX) % DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX).toBe(0);
    expect(height).toBeLessThanOrEqual(DESKTOP_SLASH_POPUP_DESIGN_CAP_PX);
  });

  test('respects measured available space and overlay placement', () => {
    expect(resolveDesktopSlashPopupMaxHeight({
      availablePx: 400,
      rowHeightPx: 59,
      chromePx: 36,
    })).toBe(36 + 6 * 59);
    expect(resolveDesktopSlashPopupMaxHeight({
      overlayMaxHeightPx: 260,
      rowHeightPx: 59,
      chromePx: 36,
    })).toBe(36 + 3 * 59);
  });
});

describe('readOverlayMaxHeight', () => {
  test('reads numeric and CSS-pixel overlay caps', () => {
    expect(readOverlayMaxHeight({ maxHeight: 260 })).toBe(260);
    expect(readOverlayMaxHeight({ maxHeight: '260px' })).toBe(260);
    expect(readOverlayMaxHeight({})).toBeUndefined();
  });
});
