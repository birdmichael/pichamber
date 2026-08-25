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

function mockDocumentClassList() {
  const classes = new Set<string>();
  const originalDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      documentElement: {
        classList: {
          toggle: (name: string, force?: boolean) => {
            if (force) {
              classes.add(name);
              return;
            }
            classes.delete(name);
          },
          contains: (name: string) => classes.has(name),
          remove: (name: string) => {
            classes.delete(name);
          },
        },
      },
    },
  });
  return {
    classes,
    restore: () => {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: originalDocument,
      });
    },
  };
}

afterEach(() => {
  resetDialogOpenLayerForTests();
});

describe('dialog open layer', () => {
  test('tracks nested layers and only the last dialog may drop pointer-events on exit', () => {
    const { classes, restore } = mockDocumentClassList();
    try {
      expect(isDialogLayerOpen()).toBe(false);
      expect(shouldDropPointerEventsOnDialogExit()).toBe(true);

      const unmarkSettings = markDialogLayerMounted();
      expect(getOpenDialogLayerCount()).toBe(1);
      expect(isDialogLayerOpen()).toBe(true);
      expect(shouldDropPointerEventsOnDialogExit()).toBe(true);
      expect(classes.has(DIALOG_OPEN_CLASS)).toBe(true);

      const unmarkNested = markDialogLayerMounted();
      expect(getOpenDialogLayerCount()).toBe(2);
      expect(shouldDropPointerEventsOnDialogExit()).toBe(false);

      unmarkNested();
      expect(getOpenDialogLayerCount()).toBe(1);
      expect(shouldDropPointerEventsOnDialogExit()).toBe(true);
      expect(classes.has(DIALOG_OPEN_CLASS)).toBe(true);

      unmarkSettings();
      expect(isDialogLayerOpen()).toBe(false);
      expect(classes.has(DIALOG_OPEN_CLASS)).toBe(false);
    } finally {
      restore();
    }
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
    const inside = {
      closest: (selector: string) => (
        selector.includes('[role="dialog"]') ? {} : null
      ),
    } as unknown as Element;
    const outside = {
      closest: () => null,
    } as unknown as Element;

    expect(isElementInsideDialog(inside)).toBe(true);
    expect(isElementInsideDialog(outside)).toBe(false);
    expect(isElementInsideDialog(null)).toBe(false);
  });
});
