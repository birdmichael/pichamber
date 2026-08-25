import { afterEach, describe, expect, test } from 'bun:test';

import {
  DIALOG_OPEN_CLASS,
  getOpenDialogLayerCount,
  isDialogLayerOpen,
  isElementInsideDialog,
  markDialogLayerMounted,
  resetDialogOpenLayerForTests,
  shouldDropPointerEventsOnDialogExit,
  subscribeDialogOpenLayer,
} from './dialog-open-layer';

afterEach(() => {
  resetDialogOpenLayerForTests();
});

describe('dialog open layer', () => {
  test('tracks nested layers and only the last dialog may drop pointer-events on exit', () => {
    expect(isDialogLayerOpen()).toBe(false);
    expect(shouldDropPointerEventsOnDialogExit()).toBe(true);

    const unmarkSettings = markDialogLayerMounted();
    expect(getOpenDialogLayerCount()).toBe(1);
    expect(isDialogLayerOpen()).toBe(true);
    expect(shouldDropPointerEventsOnDialogExit()).toBe(true);
    expect(document.documentElement.classList.contains(DIALOG_OPEN_CLASS)).toBe(true);

    const unmarkNested = markDialogLayerMounted();
    expect(getOpenDialogLayerCount()).toBe(2);
    expect(shouldDropPointerEventsOnDialogExit()).toBe(false);

    unmarkNested();
    expect(getOpenDialogLayerCount()).toBe(1);
    expect(shouldDropPointerEventsOnDialogExit()).toBe(true);
    expect(document.documentElement.classList.contains(DIALOG_OPEN_CLASS)).toBe(true);

    unmarkSettings();
    expect(isDialogLayerOpen()).toBe(false);
    expect(document.documentElement.classList.contains(DIALOG_OPEN_CLASS)).toBe(false);
  });

  test('notifies subscribers when a layer mounts or unmounts', () => {
    const seen: number[] = [];
    const unsubscribe = subscribeDialogOpenLayer(() => {
      seen.push(getOpenDialogLayerCount());
    });

    const unmark = markDialogLayerMounted();
    unmark();
    unsubscribe();

    expect(seen).toEqual([1, 0]);
  });

  test('treats only nodes inside a dialog popup as in-dialog triggers', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const inside = document.createElement('button');
    dialog.append(inside);
    const outside = document.createElement('button');
    document.body.append(dialog, outside);

    try {
      expect(isElementInsideDialog(inside)).toBe(true);
      expect(isElementInsideDialog(outside)).toBe(false);
      expect(isElementInsideDialog(null)).toBe(false);
    } finally {
      dialog.remove();
      outside.remove();
    }
  });
});
