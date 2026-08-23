import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  getDefaultTheme,
  getThemeById,
} from './index';

describe('built-in product theme identity', () => {
  test('keeps persisted ids while showing the Pichamber label', () => {
    expect(DEFAULT_LIGHT_THEME_ID).toBe('openchamber-light');
    expect(DEFAULT_DARK_THEME_ID).toBe('openchamber-dark');

    const light = getThemeById(DEFAULT_LIGHT_THEME_ID);
    const dark = getThemeById(DEFAULT_DARK_THEME_ID);

    expect(light?.metadata.id).toBe('openchamber-light');
    expect(dark?.metadata.id).toBe('openchamber-dark');
    expect(light?.metadata.name).toBe('Pichamber');
    expect(dark?.metadata.name).toBe('Pichamber');
  });

  test('default light and dark themes still resolve from the stored product ids', () => {
    expect(getDefaultTheme(false).metadata.id).toBe('openchamber-light');
    expect(getDefaultTheme(true).metadata.id).toBe('openchamber-dark');
  });
});
