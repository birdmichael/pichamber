import { describe, expect, mock, test } from 'bun:test';

import {
  activateTitlebarIconOnPointerDown,
  isPrimaryTitlebarPointer,
} from './titlebarIconActivate';

describe('titlebarIconActivate', () => {
  test('treats the primary button as the titlebar press', () => {
    expect(isPrimaryTitlebarPointer(0)).toBe(true);
    expect(isPrimaryTitlebarPointer(1)).toBe(false);
    expect(isPrimaryTitlebarPointer(2)).toBe(false);
  });

  test('primary pointerdown closes hover UI and runs the action once', () => {
    const closeHoverUi = mock(() => {});
    const activate = mock(() => {});

    const consumed = activateTitlebarIconOnPointerDown({
      button: 0,
      closeHoverUi,
      activate,
    });

    expect(consumed).toBe(true);
    expect(closeHoverUi).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  test('non-primary pointerdown leaves the action for a later click', () => {
    const closeHoverUi = mock(() => {});
    const activate = mock(() => {});

    const consumed = activateTitlebarIconOnPointerDown({
      button: 2,
      closeHoverUi,
      activate,
    });

    expect(consumed).toBe(false);
    expect(closeHoverUi).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });
});
