import { describe, expect, it } from 'vitest';
import {
  SURFACE_PROFILES_KEY,
  commitPerSurfaceProfileWrite,
  isPerSurfaceProfileKey,
  normalizeSettingsSurface,
  resolveSettingsForSurface,
  settingsSurfaceOf,
  stripSurfaceProfiles,
} from './settings-surface-profile.js';

describe('settings-surface-profile', () => {
  it('recognizes OpenChamber theme/font/layout per-surface keys', () => {
    expect(isPerSurfaceProfileKey('themeId')).toBe(true);
    expect(isPerSurfaceProfileKey('fontSize')).toBe(true);
    expect(isPerSurfaceProfileKey('wideChatLayoutEnabled')).toBe(true);
    expect(isPerSurfaceProfileKey('uiFont')).toBe(false);
    expect(isPerSurfaceProfileKey('monoFont')).toBe(false);
    expect(isPerSurfaceProfileKey('sidebarWidth')).toBe(false);
  });

  it('normalizes known surfaces and rejects junk', () => {
    expect(normalizeSettingsSurface('desktop')).toBe('desktop');
    expect(normalizeSettingsSurface(' mobile ')).toBe('mobile');
    expect(normalizeSettingsSurface('tablet')).toBeNull();
    expect(normalizeSettingsSurface(null)).toBeNull();
  });

  it('reads surface from query or header', () => {
    expect(settingsSurfaceOf({ query: { surface: 'desktop' } })).toBe('desktop');
    expect(settingsSurfaceOf({
      query: {},
      get: (name) => (name === 'x-openchamber-surface' ? 'mobile' : undefined),
    })).toBe('mobile');
    expect(settingsSurfaceOf({ query: {} })).toBeNull();
  });

  it('resolves overlay over base for one surface and leaves others on base', () => {
    const document = {
      themeId: 'base-theme',
      fontSize: 100,
      projects: [],
      [SURFACE_PROFILES_KEY]: {
        desktop: { fontSize: 110, wideChatLayoutEnabled: true },
        mobile: { fontSize: 130 },
      },
    };

    expect(resolveSettingsForSurface(document, 'desktop')).toMatchObject({
      themeId: 'base-theme',
      fontSize: 110,
      wideChatLayoutEnabled: true,
      projects: [],
    });
    expect(resolveSettingsForSurface(document, 'desktop')).not.toHaveProperty(SURFACE_PROFILES_KEY);
    expect(resolveSettingsForSurface(document, 'mobile').fontSize).toBe(130);
    expect(resolveSettingsForSurface(document, 'web').fontSize).toBe(100);
    expect(resolveSettingsForSurface(document, null).fontSize).toBe(100);
    expect(stripSurfaceProfiles(document)).not.toHaveProperty(SURFACE_PROFILES_KEY);
  });

  it('stores a per-surface write under the surface and restores the base', () => {
    const before = {
      themeId: 'base-theme',
      fontSize: 100,
      showReasoningTraces: true,
    };
    const after = {
      ...before,
      fontSize: 110,
      wideChatLayoutEnabled: true,
      showReasoningTraces: false,
    };
    const sanitized = {
      fontSize: 110,
      wideChatLayoutEnabled: true,
      showReasoningTraces: false,
    };

    const committed = commitPerSurfaceProfileWrite(before, after, sanitized, 'desktop');
    expect(committed.fontSize).toBe(100);
    expect(committed).not.toHaveProperty('wideChatLayoutEnabled');
    expect(committed.showReasoningTraces).toBe(false);
    expect(committed[SURFACE_PROFILES_KEY].desktop).toEqual({
      fontSize: 110,
      wideChatLayoutEnabled: true,
    });
    expect(resolveSettingsForSurface(committed, 'desktop')).toMatchObject({
      fontSize: 110,
      wideChatLayoutEnabled: true,
      themeId: 'base-theme',
      showReasoningTraces: false,
    });
    expect(resolveSettingsForSurface(committed, 'mobile').fontSize).toBe(100);
  });

  it('leaves non-surface writes untouched', () => {
    const before = { fontSize: 100 };
    const after = { fontSize: 100, showReasoningTraces: false };
    const committed = commitPerSurfaceProfileWrite(before, after, { showReasoningTraces: false }, 'desktop');
    expect(committed).toEqual(after);
  });
});

describe('settings-surface-profile + runtime wiring contract', () => {
  it('lists the same theme/font/layout keys OpenChamber marks perSurface (excluding shared uiFont/monoFont)', () => {
    const expected = [
      'themeId',
      'useSystemTheme',
      'lightThemeId',
      'darkThemeId',
      'streamingAutoFollowEnabled',
      'stickyUserHeader',
      'promptNavigatorEnabled',
      'wideChatLayoutEnabled',
      'fontSize',
      'terminalFontSize',
      'editorFontSize',
      'padding',
      'cornerRadius',
    ];
    for (const key of expected) {
      expect(isPerSurfaceProfileKey(key)).toBe(true);
    }
  });
});
