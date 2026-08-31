import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { shouldOpenSettingsNavOnPointerDown } from './settingsNavOpen';

const settingsViewSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'SettingsView.tsx'),
  'utf8',
);

const mouse = { button: 0, pointerType: 'mouse' as const };

describe('settings nav open', () => {
  test('desktop mouse primary press may open the page immediately', () => {
    expect(shouldOpenSettingsNavOnPointerDown(mouse)).toBe(true);
    expect(shouldOpenSettingsNavOnPointerDown(mouse, { isMobile: false })).toBe(true);
  });

  test('mobile layout never opens on pointerdown, even with a mouse', () => {
    expect(shouldOpenSettingsNavOnPointerDown(mouse, { isMobile: true })).toBe(false);
    expect(shouldOpenSettingsNavOnPointerDown({ button: 0, pointerType: 'touch' }, { isMobile: true })).toBe(false);
  });

  test('touch and pen must not open on pointerdown so the list can scroll', () => {
    expect(shouldOpenSettingsNavOnPointerDown({ button: 0, pointerType: 'touch' })).toBe(false);
    expect(shouldOpenSettingsNavOnPointerDown({ button: 0, pointerType: 'pen' })).toBe(false);
  });

  test('non-primary mouse buttons do not open', () => {
    expect(shouldOpenSettingsNavOnPointerDown({ button: 1, pointerType: 'mouse' })).toBe(false);
  });

  test('SettingsView gates pointerdown with the helper, isMobile, and still opens on click', () => {
    expect(settingsViewSource).toContain('shouldOpenSettingsNavOnPointerDown(event, { isMobile })');
    expect(settingsViewSource).toContain('openPage(page.slug)');
    expect(settingsViewSource).toContain('touch-pan-y');
  });
});
