import { afterEach, describe, expect, test } from 'bun:test';

import { markDialogLayerMounted, resetDialogOpenLayerForTests } from './dialog-open-layer';
import {
  isPrimaryMouseTooltipPointer,
  isTooltipTriggerBehindModal,
  shouldSuppressTooltipOpen,
} from './tooltip-press';

afterEach(() => {
  resetDialogOpenLayerForTests();
});

describe('tooltip press', () => {
  test('blocks opening while the activating mouse press is down', () => {
    expect(shouldSuppressTooltipOpen({
      nextOpen: true,
      pointerPressActive: true,
    })).toBe(true);
  });

  test('allows hover open after the press ends', () => {
    expect(shouldSuppressTooltipOpen({
      nextOpen: true,
      pointerPressActive: false,
    })).toBe(false);
  });

  test('still allows close during the press', () => {
    expect(shouldSuppressTooltipOpen({
      nextOpen: false,
      pointerPressActive: true,
    })).toBe(false);
  });

  test('treats only the primary mouse button as an activating press', () => {
    expect(isPrimaryMouseTooltipPointer('mouse', 0)).toBe(true);
    expect(isPrimaryMouseTooltipPointer('mouse', 2)).toBe(false);
    expect(isPrimaryMouseTooltipPointer('touch', 0)).toBe(false);
  });
});

describe('tooltip behind modal', () => {
  test('does not hide hover-cards when no dialog is open', () => {
    const sidebarTrigger = {
      closest: () => null,
    } as unknown as Element;

    expect(isTooltipTriggerBehindModal(sidebarTrigger)).toBe(false);
    expect(shouldSuppressTooltipOpen({
      nextOpen: true,
      pointerPressActive: false,
      trigger: sidebarTrigger,
    })).toBe(false);
  });

  test('blocks sidebar triggers while a dialog layer is open', () => {
    const unmark = markDialogLayerMounted();
    const sidebarTrigger = {
      closest: () => null,
    } as unknown as Element;

    try {
      expect(isTooltipTriggerBehindModal(sidebarTrigger)).toBe(true);
      expect(shouldSuppressTooltipOpen({
        nextOpen: true,
        pointerPressActive: false,
        trigger: sidebarTrigger,
      })).toBe(true);
      expect(shouldSuppressTooltipOpen({
        nextOpen: false,
        pointerPressActive: false,
        trigger: sidebarTrigger,
      })).toBe(false);
    } finally {
      unmark();
    }
  });

  test('still allows tooltips whose trigger is inside the dialog', () => {
    const unmark = markDialogLayerMounted();
    const insideTrigger = {
      closest: (selector: string) => (
        selector.includes('[role="dialog"]') ? {} : null
      ),
    } as unknown as Element;

    try {
      expect(isTooltipTriggerBehindModal(insideTrigger)).toBe(false);
      expect(shouldSuppressTooltipOpen({
        nextOpen: true,
        pointerPressActive: false,
        trigger: insideTrigger,
      })).toBe(false);
    } finally {
      unmark();
    }
  });
});
