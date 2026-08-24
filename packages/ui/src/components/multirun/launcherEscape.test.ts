import { describe, expect, test } from 'bun:test';

import { isLauncherOverlayOpen, markLauncherOverlay, resetLauncherOverlays, shouldCloseLauncherFormOnEscape } from './launcherEscape';

const rootWith = (hit: string | null): ParentNode => ({
  querySelector: (selector: string) => (selector === hit ? {} : null),
  querySelectorAll: (selector: string) => {
    if (selector !== '[data-popup-open]' || hit !== '[data-popup-open]') return [];
    return [{
      getAttribute: () => 'true',
    }];
  },
} as unknown as ParentNode);

describe('isLauncherOverlayOpen', () => {
  test('is false when nothing is open', () => {
    resetLauncherOverlays();
    expect(isLauncherOverlayOpen(rootWith(null))).toBe(false);
  });

  test('is true when the model picker trigger is open', () => {
    resetLauncherOverlays();
    expect(isLauncherOverlayOpen(rootWith('[data-popup-open]'))).toBe(true);
  });

  test('treats an empty data-popup-open attribute as open', () => {
    resetLauncherOverlays();
    const root = {
      querySelector: () => null,
      querySelectorAll: (selector: string) => {
        if (selector !== '[data-popup-open]') return [];
        return [{ getAttribute: () => '' }];
      },
    } as unknown as ParentNode;
    expect(isLauncherOverlayOpen(root)).toBe(true);
  });

  test('ignores an explicit closed data-popup-open attribute', () => {
    resetLauncherOverlays();
    const root = {
      querySelector: () => null,
      querySelectorAll: (selector: string) => {
        if (selector !== '[data-popup-open]') return [];
        return [{ getAttribute: () => 'false' }];
      },
    } as unknown as ParentNode;
    expect(isLauncherOverlayOpen(root)).toBe(false);
  });

  test('is true when the mounted model list is present', () => {
    resetLauncherOverlays();
    expect(isLauncherOverlayOpen(rootWith('[data-model-picker-list]'))).toBe(true);
  });

  test('is true when a select overlay is mounted', () => {
    resetLauncherOverlays();
    expect(isLauncherOverlayOpen(rootWith('[data-slot="select-content"]'))).toBe(true);
  });

  test('does not treat a persistent document listbox as an open overlay', () => {
    resetLauncherOverlays();
    expect(isLauncherOverlayOpen(rootWith('[role="listbox"]'))).toBe(false);
  });

  test('uses the overlay registry even without a document', () => {
    resetLauncherOverlays();
    markLauncherOverlay('picker-1', true);
    expect(isLauncherOverlayOpen(null)).toBe(true);
    markLauncherOverlay('picker-1', false);
    expect(isLauncherOverlayOpen(null)).toBe(false);
  });
});

describe('shouldCloseLauncherFormOnEscape', () => {
  test('does not close the form while an overlay is open', () => {
    expect(shouldCloseLauncherFormOnEscape(true)).toBe(false);
  });

  test('closes the form when no overlay is open', () => {
    expect(shouldCloseLauncherFormOnEscape(false)).toBe(true);
  });
});
