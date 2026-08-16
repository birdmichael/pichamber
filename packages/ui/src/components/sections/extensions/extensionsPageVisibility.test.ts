import { describe, expect, test } from 'bun:test';
import { shouldShowExtensionsSection } from './extensionsPageVisibility';

describe('shouldShowExtensionsSection', () => {
  test('keeps the section while loading', () => {
    expect(shouldShowExtensionsSection({ loading: true, extensionCount: 0, packageCount: 1 })).toBe(true);
  });

  test('shows the section when extensions are present', () => {
    expect(shouldShowExtensionsSection({ loading: false, extensionCount: 2, packageCount: 0 })).toBe(true);
  });

  test('omits the empty extensions block when packages are listed', () => {
    expect(shouldShowExtensionsSection({ loading: false, extensionCount: 0, packageCount: 1 })).toBe(false);
  });

  test('keeps a Pi-specific empty state when both lists are empty', () => {
    expect(shouldShowExtensionsSection({ loading: false, extensionCount: 0, packageCount: 0 })).toBe(true);
  });
});
