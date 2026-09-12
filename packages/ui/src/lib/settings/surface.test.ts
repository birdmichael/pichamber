import { describe, expect, test } from 'bun:test';
import { getSettingsSurface, SETTINGS_SURFACE_QUERY, type SettingsSurface } from './surface';

describe('settings surface', () => {
  test('exports the surface query key used on settings GET/PUT', () => {
    expect(SETTINGS_SURFACE_QUERY).toBe('surface');
  });

  test('getSettingsSurface returns a known settings surface kind', () => {
    const surface = getSettingsSurface();
    const allowed: SettingsSurface[] = ['web', 'desktop', 'vscode', 'mobile'];
    expect(allowed).toContain(surface);
  });
});
