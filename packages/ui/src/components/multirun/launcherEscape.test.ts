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

  test('does not treat a mounted but closed model list as an open overlay', () => {
    resetLauncherOverlays();
    expect(isLauncherOverlayOpen(rootWith('[data-model-picker-list]'))).toBe(false);
  });

  test('is true when a select overlay is actually open', () => {
    resetLauncherOverlays();
    expect(isLauncherOverlayOpen(rootWith('[data-slot="select-content"][data-open]'))).toBe(true);
  });

  test('does not treat a closed select popup as an open overlay', () => {
    resetLauncherOverlays();
    expect(isLauncherOverlayOpen(rootWith('[data-slot="select-content"]'))).toBe(false);
  });

  test('does not treat a closed dropdown menu as an open overlay', () => {
    resetLauncherOverlays();
    expect(isLauncherOverlayOpen(rootWith('[data-slot="dropdown-menu-content"]'))).toBe(false);
  });

  test('does not treat a persistent document listbox as an open overlay', () => {
    resetLauncherOverlays();
    expect(isLauncherOverlayOpen(rootWith('[role="listbox"]'))).toBe(false);
  });

  test('does not see overlays outside the scoped launcher root', () => {
    resetLauncherOverlays();
    const launcher = {
      querySelector: () => null,
      querySelectorAll: () => [],
    } as unknown as ParentNode;
    expect(isLauncherOverlayOpen(launcher)).toBe(false);
  });

  test('uses the overlay registry even without a document', () => {
    resetLauncherOverlays();
    markLauncherOverlay('picker-1', true);
    expect(isLauncherOverlayOpen(null)).toBe(true);
    markLauncherOverlay('picker-1', false);
    expect(isLauncherOverlayOpen(null)).toBe(false);
  });
});

describe('MultiRunLauncher Esc scope', () => {
  test('queries the launcher form, not the whole document', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'MultiRunLauncher.tsx'),
      'utf-8',
    );
    expect(source).toContain('isLauncherOverlayOpen(launcherRootRef.current)');
    expect(source).toContain('ref={launcherRootRef}');
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
