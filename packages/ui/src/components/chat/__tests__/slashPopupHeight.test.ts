import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';
import {
  DESKTOP_SLASH_DESCRIPTION_CLASS,
  DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX,
  DESKTOP_SLASH_POPUP_DESIGN_CAP_PX,
  DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX,
  measureDesktopSlashAvailablePx,
  readOverlayMaxHeight,
  resolveDesktopSlashPopupMaxHeight,
  shouldDockComposerForDesktopSlashMenu,
  shouldHideNewSessionWelcomeForDesktopSlashMenu,
  snapSlashPopupMaxHeight,
} from '../slashPopupHeight';

const chatInputSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../ChatInput.tsx'),
  'utf-8',
);
const commandAutocompleteSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../CommandAutocomplete.tsx'),
  'utf-8',
);

function describedRowsForAvailablePx(availablePx: number): number {
  const height = resolveDesktopSlashPopupMaxHeight({
    availablePx,
    rowHeightPx: DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX,
    chromePx: DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX,
  });
  return Math.floor((height - DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX) / DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX);
}

describe('snapSlashPopupMaxHeight', () => {
  test('the old 256px cap leaves a clipped remainder on described rows', () => {
    const height = snapSlashPopupMaxHeight({
      availablePx: 256,
      rowHeightPx: DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX,
      chromePx: DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX,
    });
    expect(Math.floor((256 - DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX) / DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX)).toBe(2);
    expect((height - DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX) % DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX).toBe(0);
    expect(Math.floor((height - DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX) / DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX)).toBe(2);
  });

  test('always lands on a whole number of rows', () => {
    const height = snapSlashPopupMaxHeight({
      availablePx: 500,
      rowHeightPx: 59,
      chromePx: 36,
    });
    expect(height).toBe(36 + 7 * 59);
    expect((height - 36) % 59).toBe(0);
    expect(height <= 500).toBe(true);
    expect(Math.floor((height - 36) / 59) >= 1).toBe(true);
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
  test('the design cap fits at least seven full wrapped-description rows', () => {
    const height = resolveDesktopSlashPopupMaxHeight({
      rowHeightPx: DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX,
      chromePx: DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX,
    });
    const rows = Math.floor((height - DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX) / DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX);
    expect(rows >= 7).toBe(true);
    expect((height - DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX) % DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX).toBe(0);
    expect(height <= DESKTOP_SLASH_POPUP_DESIGN_CAP_PX).toBe(true);
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

  test('a docked 1280x800 chat column fits at least six full wrapped-description rows', () => {
    const availablePx = measureDesktopSlashAvailablePx({
      chatTopPx: 48,
      popupBottomPx: 800 - 220,
    });
    const height = resolveDesktopSlashPopupMaxHeight({
      availablePx,
      rowHeightPx: DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX,
      chromePx: DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX,
    });
    const rows = Math.floor((height - DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX) / DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX);
    expect(availablePx >= 520).toBe(true);
    expect(rows >= 6).toBe(true);
    expect((height - DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX) % DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX).toBe(0);
  });

  test('docking with the welcome title and chips still in the form stays under six rows', () => {
    const availablePx = measureDesktopSlashAvailablePx({
      chatTopPx: 48,
      popupBottomPx: 474,
    });
    expect(describedRowsForAvailablePx(availablePx) >= 6).toBe(false);
  });

  test('hiding welcome chrome on a 1280x800 new session fits at least six full wrapped-description rows', () => {
    const availablePx = measureDesktopSlashAvailablePx({
      chatTopPx: 48,
      popupBottomPx: 572,
    });
    const height = resolveDesktopSlashPopupMaxHeight({
      availablePx,
      rowHeightPx: DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX,
      chromePx: DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX,
    });
    const rows = describedRowsForAvailablePx(availablePx);
    expect(availablePx >= 508).toBe(true);
    expect(rows >= 6).toBe(true);
    expect((height - DESKTOP_SLASH_POPUP_CHROME_ESTIMATE_PX) % DESKTOP_SLASH_POPUP_ROW_ESTIMATE_PX).toBe(0);
  });
});

describe('shouldDockComposerForDesktopSlashMenu', () => {
  test('docks only a Desktop new-session composer while `/` is open', () => {
    expect(shouldDockComposerForDesktopSlashMenu({
      isMobile: false,
      isDesktopExpanded: false,
      newSessionDraftOpen: true,
      commandAutocompleteOpen: true,
    })).toBe(true);
    expect(shouldDockComposerForDesktopSlashMenu({
      isMobile: false,
      isDesktopExpanded: false,
      newSessionDraftOpen: true,
      commandAutocompleteOpen: false,
    })).toBe(false);
    expect(shouldDockComposerForDesktopSlashMenu({
      isMobile: true,
      isDesktopExpanded: false,
      newSessionDraftOpen: true,
      commandAutocompleteOpen: true,
    })).toBe(false);
  });

  test('hides the new-session title and starter chips on that same Desktop `/` moment', () => {
    const open = {
      isMobile: false,
      isDesktopExpanded: false,
      newSessionDraftOpen: true,
      commandAutocompleteOpen: true,
    };
    const closed = { ...open, commandAutocompleteOpen: false };
    expect(shouldHideNewSessionWelcomeForDesktopSlashMenu(open)).toBe(true);
    expect(shouldHideNewSessionWelcomeForDesktopSlashMenu(closed)).toBe(false);
    expect(shouldHideNewSessionWelcomeForDesktopSlashMenu(open)).toBe(
      shouldDockComposerForDesktopSlashMenu(open),
    );
  });

  test('ChatInput hides welcome chrome and cancels the 6vh inset while Desktop `/` is open', () => {
    expect(chatInputSource.includes('shouldHideNewSessionWelcomeForDesktopSlashMenu')).toBe(true);
    expect(chatInputSource.includes('showNewSessionWelcome')).toBe(true);
    expect(chatInputSource.includes('-mb-[6vh]')).toBe(true);
  });

  test('Desktop slash descriptions wrap instead of clipping mid-word', () => {
    expect(DESKTOP_SLASH_DESCRIPTION_CLASS.includes('line-clamp-2')).toBe(true);
    expect(DESKTOP_SLASH_DESCRIPTION_CLASS.includes('whitespace-normal')).toBe(true);
    expect(DESKTOP_SLASH_DESCRIPTION_CLASS.includes('truncate')).toBe(false);
    expect(commandAutocompleteSource.includes('DESKTOP_SLASH_DESCRIPTION_CLASS')).toBe(true);
    expect(commandAutocompleteSource.includes('typography-meta text-muted-foreground mt-0.5 truncate')).toBe(false);
  });
});

describe('measureDesktopSlashAvailablePx', () => {
  test('a centered new-session composer only has a 256px stub above it', () => {
    expect(measureDesktopSlashAvailablePx({
      chatTopPx: 48,
      popupBottomPx: 48 + 256 + 8,
    })).toBe(256);
  });
});

describe('readOverlayMaxHeight', () => {
  test('reads numeric and CSS-pixel overlay caps', () => {
    expect(readOverlayMaxHeight({ maxHeight: 260 })).toBe(260);
    expect(readOverlayMaxHeight({ maxHeight: '260px' })).toBe(260);
    expect(readOverlayMaxHeight({})).toEqual(undefined);
  });
});
