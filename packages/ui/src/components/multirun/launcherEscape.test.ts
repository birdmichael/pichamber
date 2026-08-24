import { describe, expect, test } from 'bun:test';

import { isLauncherOverlayOpen } from './launcherEscape';

describe('isLauncherOverlayOpen', () => {
  test('is false when nothing is open', () => {
    const root = { querySelector: () => null };
    expect(isLauncherOverlayOpen(root as unknown as ParentNode)).toBe(false);
  });

  test('is true when the model picker trigger is open', () => {
    const root = {
      querySelector: (selector: string) => (selector === '[data-popup-open]' ? {} : null),
    };
    expect(isLauncherOverlayOpen(root as unknown as ParentNode)).toBe(true);
  });

  test('is true when a select or listbox overlay is mounted', () => {
    const root = {
      querySelector: (selector: string) => (selector === '[role="listbox"]' ? {} : null),
    };
    expect(isLauncherOverlayOpen(root as unknown as ParentNode)).toBe(true);
  });
});
