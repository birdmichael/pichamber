import { describe, expect, test } from 'bun:test';
import {
  buildPreferencesFields,
  flattenPreferences,
  isProfileSettingsKey,
  parsePreferencesDocument,
  serializePreferencesDocument,
  seedPreferencesFrom,
} from './settings-files.js';

describe('settings-files preferences', () => {
  test('marks theme keys as profile', () => {
    expect(isProfileSettingsKey('themeId')).toBe(true);
    expect(isProfileSettingsKey('projects')).toBe(false);
  });

  test('round-trips a preferences document', () => {
    const fields = seedPreferencesFrom({ themeId: 'dark', fontSize: 14, projects: [] }, 1000);
    expect(fields.themeId.value).toBe('dark');
    expect(fields.projects).toBeUndefined();
    const raw = serializePreferencesDocument(fields);
    const parsed = parsePreferencesDocument(raw);
    expect(parsed.ok).toBe(true);
    expect(flattenPreferences(parsed.fields).themeId).toBe('dark');
  });

  test('stores per-surface theme without clobbering base', () => {
    const previous = seedPreferencesFrom({ themeId: 'base-theme' }, 1);
    const next = buildPreferencesFields(previous, { themeId: 'desktop-theme' }, 2, {
      surface: 'desktop',
      changedKeys: ['themeId'],
    });
    expect(next.themeId.value).toBe('base-theme');
    expect(next.themeId.surfaces.desktop.value).toBe('desktop-theme');
    expect(flattenPreferences(next, 'desktop').themeId).toBe('desktop-theme');
    expect(flattenPreferences(next, 'web').themeId).toBe('base-theme');
  });
});
