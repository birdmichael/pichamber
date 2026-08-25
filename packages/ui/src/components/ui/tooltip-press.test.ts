import { afterEach, describe, expect, test } from 'bun:test';

import { markDialogLayerMounted, resetDialogOpenLayerForTests } from './dialog-open-layer';
import {
  isPrimaryMouseTooltipPointer,
  isTooltipTriggerBehindModal,
  resetTooltipWindowBlurForTests,
  shouldAllowTooltipDismissPropagation,
  shouldSuppressTooltipOpen,
  subscribeTooltipWindowBlur,
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

  test('lets the dismiss press reach the control under a leftover tooltip', () => {
    expect(shouldAllowTooltipDismissPropagation({
      nextOpen: false,
      reason: 'outside-press',
    })).toBe(true);
    expect(shouldAllowTooltipDismissPropagation({
      nextOpen: false,
      reason: 'trigger-press',
    })).toBe(true);
  });

  test('does not rewrite hover, focus, or open transitions', () => {
    expect(shouldAllowTooltipDismissPropagation({
      nextOpen: true,
      reason: 'outside-press',
    })).toBe(false);
    expect(shouldAllowTooltipDismissPropagation({
      nextOpen: false,
      reason: 'trigger-hover',
    })).toBe(false);
    expect(shouldAllowTooltipDismissPropagation({
      nextOpen: false,
      reason: 'trigger-focus',
    })).toBe(false);
    expect(shouldAllowTooltipDismissPropagation({
      nextOpen: false,
      reason: 'escape-key',
    })).toBe(false);
  });

  test('notifies mounted tooltips once when the window blurs', () => {
    resetTooltipWindowBlurForTests();
    const blurHandlers: Array<() => void> = [];
    const previousWindow = (globalThis as { window?: unknown }).window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        addEventListener: (type: string, handler: () => void) => {
          if (type === 'blur') blurHandlers.push(handler);
        },
        removeEventListener: () => undefined,
      },
    });

    try {
      const first = { calls: 0 };
      const second = { calls: 0 };
      const unsubscribeFirst = subscribeTooltipWindowBlur(() => {
        first.calls += 1;
      });
      const unsubscribeSecond = subscribeTooltipWindowBlur(() => {
        second.calls += 1;
      });

      for (const handler of blurHandlers) handler();
      expect(first.calls).toBe(1);
      expect(second.calls).toBe(1);

      unsubscribeFirst();
      for (const handler of blurHandlers) handler();
      expect(first.calls).toBe(1);
      expect(second.calls).toBe(2);
      unsubscribeSecond();
    } finally {
      resetTooltipWindowBlurForTests();
      if (previousWindow === undefined) {
        Reflect.deleteProperty(globalThis, 'window');
      } else {
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: previousWindow,
        });
      }
    }
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
