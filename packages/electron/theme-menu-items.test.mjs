import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeThemeMenuMode, themeMenuItemDescriptors } from './theme-menu-items.mjs';

test('normalizeThemeMenuMode falls back to system', () => {
  assert.equal(normalizeThemeMenuMode('light'), 'light');
  assert.equal(normalizeThemeMenuMode('dark'), 'dark');
  assert.equal(normalizeThemeMenuMode('system'), 'system');
  assert.equal(normalizeThemeMenuMode(''), 'system');
  assert.equal(normalizeThemeMenuMode(undefined), 'system');
});

test('themeMenuItemDescriptors marks exactly one radio checked', () => {
  for (const mode of ['light', 'dark', 'system']) {
    const items = themeMenuItemDescriptors(mode);
    assert.equal(items.length, 3);
    assert.ok(items.every((item) => item.type === 'radio'));
    assert.equal(items.filter((item) => item.checked).length, 1);
    assert.equal(items.find((item) => item.checked)?.action, `theme-${mode}`);
  }
});
