import { describe, expect, test } from 'bun:test';
import type { I18nKey } from '@/lib/i18n/store';
import {
  MOBILE_UNSUPPORTED_SETTINGS_PAGES,
  SETTINGS_PAGE_METADATA,
  getSettingsPageMeta,
  isSettingsPageAvailable,
  listVisibleSettingsPageSlugs,
  type SettingsPageSlug,
  type SettingsRuntimeContext,
} from './metadata';
import { buildSettingsSearchResults } from './search';

const t = (key: I18nKey): string => key;

const desktopPi: SettingsRuntimeContext = {
  isVSCode: false,
  isWeb: false,
  isDesktop: true,
  isMobile: false,
  isPiKernel: true,
  isMcpFeaturePluginActive: true,
};

const mobilePi: SettingsRuntimeContext = {
  isVSCode: false,
  isWeb: true,
  isDesktop: false,
  isMobile: true,
  isPiKernel: true,
  isMcpFeaturePluginActive: true,
};

const mobilePiHosted = mobilePi;

const mobilePiCapacitor: SettingsRuntimeContext = {
  ...mobilePi,
  isCapacitor: true,
};

const desktopOpenCode: SettingsRuntimeContext = {
  isVSCode: false,
  isWeb: false,
  isDesktop: true,
  isMobile: false,
  isPiKernel: false,
};

const mobileOpenCode: SettingsRuntimeContext = {
  isVSCode: false,
  isWeb: true,
  isDesktop: false,
  isMobile: true,
  isPiKernel: false,
};

const searchRuntime = {
  isDesktopLocalOrigin: false,
  isMac: false,
  isWindows: false,
  isLinux: false,
  isWindowsArm64: false,
};

const PI_MOBILE_MUST_INCLUDE: readonly SettingsPageSlug[] = [
  'feature-plugins',
  'extensions',
  'skills.installed',
  'skills.catalog',
  'commands',
  'snippets',
  'sessions',
  'projects',
];

const PI_MOBILE_MUST_EXCLUDE: readonly SettingsPageSlug[] = [
  'usage',
  'plugins',
  'agents',
  'shortcuts',
  'remote-instances',
  'tunnel',
];

function searchPages(
  ctx: SettingsRuntimeContext,
  query: string,
  visiblePageSlugs?: SettingsPageSlug[],
): SettingsPageSlug[] {
  return buildSettingsSearchResults({
    query,
    runtimeCtx: { ...ctx, ...searchRuntime },
    visiblePageSlugs,
    t,
    getPageTitle: (page) => page,
  }).map((result) => result.page);
}

describe('mobile settings availability', () => {
  test('documents only Desktop-host and phone-unsuitable pages as mobile-unsupported', () => {
    expect([...MOBILE_UNSUPPORTED_SETTINGS_PAGES].sort()).toEqual(
      ['remote-instances', 'shortcuts', 'tunnel'].sort(),
    );
  });

  test('Pi mobile Settings matches Desktop Pi pages plus hosted About', () => {
    const mobile = listVisibleSettingsPageSlugs(mobilePi);
    const desktop = listVisibleSettingsPageSlugs(desktopPi);

    for (const slug of PI_MOBILE_MUST_INCLUDE) {
      expect(mobile).toContain(slug);
      expect(desktop).toContain(slug);
    }

    for (const slug of PI_MOBILE_MUST_EXCLUDE) {
      expect(mobile).not.toContain(slug);
    }

    expect(desktop).toContain('shortcuts');
    expect(desktop).toContain('remote-instances');
    expect(desktop).toContain('tunnel');
    expect(desktop).not.toContain('usage');
    expect(desktop).not.toContain('plugins');
    expect(desktop).not.toContain('agents');
    expect(desktop).not.toContain('about');

    expect(mobile).toContain('about');
    expect(mobile).toContain('general');
    expect(mobile).toContain('appearance');
    expect(mobile).toContain('chat');
    expect(mobile).toContain('notifications');
    expect(mobile).toContain('sessions');
    expect(mobile).toContain('git');
    expect(mobile).toContain('magic-prompts');
    expect(mobile).toContain('behavior');
    expect(mobile).toContain('mcp');
    expect(mobile).toContain('providers');
    expect(mobile).toContain('voice');
    expect(mobile).toContain('integrations');
  });

  test('Capacitor hides About; hosted mobile keeps it', () => {
    expect(listVisibleSettingsPageSlugs(mobilePiHosted)).toContain('about');
    expect(listVisibleSettingsPageSlugs(mobilePiCapacitor)).not.toContain('about');
  });

  test('OpenCode Settings keep leftover Agents; Pi hides it on Desktop and mobile', () => {
    expect(listVisibleSettingsPageSlugs(desktopOpenCode)).toContain('agents');
    expect(listVisibleSettingsPageSlugs(mobileOpenCode)).toContain('agents');
    expect(listVisibleSettingsPageSlugs(desktopPi)).not.toContain('agents');
    expect(listVisibleSettingsPageSlugs(mobilePi)).not.toContain('agents');
    expect(searchPages(desktopOpenCode, 'agents')).toContain('agents');
    expect(searchPages(desktopPi, 'agents')).not.toContain('agents');
  });

  test('OpenCode mobile keeps Usage and Plugins and hides Pi-only pages', () => {
    const slugs = listVisibleSettingsPageSlugs(mobileOpenCode);
    expect(slugs).toContain('usage');
    expect(slugs).toContain('plugins');
    expect(slugs).toContain('agents');
    expect(slugs).not.toContain('feature-plugins');
    expect(slugs).not.toContain('extensions');
    expect(slugs).not.toContain('shortcuts');
    expect(slugs).not.toContain('remote-instances');
    expect(slugs).not.toContain('tunnel');
  });

  test('Pi mobile hides MCP until the Feature Plugin slot is on', () => {
    expect(listVisibleSettingsPageSlugs({
      ...mobilePi,
      isMcpFeaturePluginActive: false,
    })).not.toContain('mcp');
    expect(listVisibleSettingsPageSlugs(mobilePi)).toContain('mcp');
  });

  test('search results use the same visible set as nav', () => {
    const visible = listVisibleSettingsPageSlugs(mobilePi);
    const visibleSet = new Set(visible);

    for (const slug of visible) {
      const meta = getSettingsPageMeta(slug);
      expect(meta).not.toBeNull();
      expect(isSettingsPageAvailable(meta!, mobilePi)).toBe(true);
    }

    const hiddenOnPiMobile = SETTINGS_PAGE_METADATA
      .filter((page) => page.slug !== 'home' && !visibleSet.has(page.slug));
    for (const page of hiddenOnPiMobile) {
      expect(isSettingsPageAvailable(page, mobilePi)).toBe(false);
    }

    const searched = new Set(searchPages(mobilePi, 'a', visible));
    for (const page of searched) {
      expect(visibleSet.has(page)).toBe(true);
    }

    expect(searchPages(mobilePi, 'usage', visible)).not.toContain('usage');
    expect(searchPages(mobilePi, 'plugins', visible)).not.toContain('plugins');
    expect(searchPages(mobilePi, 'agents', visible)).not.toContain('agents');
    expect(searchPages(mobilePi, 'shortcuts', visible)).not.toContain('shortcuts');
    expect(searchPages(mobilePi, 'remote', visible)).not.toContain('remote-instances');
    expect(searchPages(mobilePi, 'tunnel', visible)).not.toContain('tunnel');

    expect(searchPages(mobilePi, 'feature plugins', visible)).toContain('feature-plugins');
    expect(searchPages(mobilePi, 'extensions', visible)).toContain('extensions');
    expect(searchPages(mobilePi, 'skills', visible)).toContain('skills.installed');
    expect(searchPages(mobilePi, 'skills catalog', visible)).toContain('skills.catalog');
    expect(searchPages(mobilePi, 'commands', visible)).toContain('commands');
    expect(searchPages(mobilePi, 'snippets', visible)).toContain('snippets');
    expect(searchPages(mobilePi, 'sessions', visible)).toContain('sessions');
    expect(searchPages(mobilePi, 'projects', visible)).toContain('projects');
  });

  test('search hides mobile-unsupported pages even without a slug allowlist', () => {
    expect(searchPages(mobilePi, 'shortcuts')).not.toContain('shortcuts');
    expect(searchPages(mobilePi, 'remote')).not.toContain('remote-instances');
    expect(searchPages(mobilePi, 'tunnel')).not.toContain('tunnel');
    expect(searchPages(mobilePi, 'usage')).not.toContain('usage');
    expect(searchPages(desktopPi, 'shortcuts')).toContain('shortcuts');
  });
});
