import { describe, expect, test } from 'bun:test';

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
    let closeCount = 0;
    let activateCount = 0;

    const consumed = activateTitlebarIconOnPointerDown({
      button: 0,
      closeHoverUi: () => {
        closeCount += 1;
      },
      activate: () => {
        activateCount += 1;
      },
    });

    expect(consumed).toBe(true);
    expect(closeCount).toBe(1);
    expect(activateCount).toBe(1);
  });

  test('non-primary pointerdown leaves the action for a later click', () => {
    let closeCount = 0;
    let activateCount = 0;

    const consumed = activateTitlebarIconOnPointerDown({
      button: 2,
      closeHoverUi: () => {
        closeCount += 1;
      },
      activate: () => {
        activateCount += 1;
      },
    });

    expect(consumed).toBe(false);
    expect(closeCount).toBe(0);
    expect(activateCount).toBe(0);
  });
});
