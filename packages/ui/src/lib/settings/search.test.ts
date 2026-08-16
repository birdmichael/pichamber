import { describe, expect, test } from 'bun:test';
import type { I18nKey } from '@/lib/i18n/store';
import { buildSettingsSearchResults } from './search';

const t = (key: I18nKey): string => key;

const runtimeCtx = {
  isVSCode: false,
  isWeb: true,
  isDesktop: false,
  isMobile: false,
  isDesktopLocalOrigin: false,
  isMac: false,
  isWindows: false,
  isLinux: false,
  isWindowsArm64: false,
};

describe('settings search', () => {
  test('finds the Claude Code third-party integration', () => {
    const results = buildSettingsSearchResults({
      query: 'claude',
      runtimeCtx,
      t,
      getPageTitle: (page) => page,
    });

    expect(results.some((result) => result.id === 'integrations.third-party.opencode-claude')).toBe(true);
  });

  test('finds third-party integrations by OpenChamber npm package names', () => {
    const results = buildSettingsSearchResults({
      query: '@openchamber/opencode-cursor',
      runtimeCtx,
      t,
      getPageTitle: (page) => page,
    });

    expect(results.some((result) => result.id === 'integrations.third-party.opencode-cursor-oauth')).toBe(true);
  });

  test('opens Skills and Commands pages from their titles', () => {
    const skillsResults = buildSettingsSearchResults({
      query: 'skills',
      runtimeCtx: { ...runtimeCtx, isPiKernel: true },
      t,
      getPageTitle: (page) => page,
    });
    expect(skillsResults.some((result) => result.page === 'skills.installed')).toBe(true);
    expect(skillsResults.some((result) => result.page === 'skills.catalog')).toBe(true);

    const commandResults = buildSettingsSearchResults({
      query: 'commands',
      runtimeCtx: { ...runtimeCtx, isPiKernel: true },
      t,
      getPageTitle: (page) => page,
    });
    expect(commandResults.some((result) => result.page === 'commands')).toBe(true);
  });

  test('finds coming-soon messenger placeholders', () => {
    const results = buildSettingsSearchResults({
      query: 'discord',
      runtimeCtx,
      t,
      getPageTitle: (page) => page,
    });

    expect(results.some((result) => result.id === 'integrations.messengers.discord')).toBe(true);
  });

  test('hides agent create search on Pi and keeps it on OpenCode', () => {
    const query = 'new agent';
    const getPageTitle = (page: string) => page;
    const openCodeResults = buildSettingsSearchResults({
      query,
      runtimeCtx,
      t,
      getPageTitle,
    });
    const piResults = buildSettingsSearchResults({
      query,
      runtimeCtx: { ...runtimeCtx, isPiKernel: true },
      t,
      getPageTitle,
    });

    expect(openCodeResults.some((result) => result.id === 'agents.create')).toBe(true);
    expect(piResults.some((result) => result.id === 'agents.create')).toBe(false);
  });

  test('keeps Session Goal settings searchable on Pi and hidden in VS Code', () => {
    const query = 'goal';
    const getPageTitle = (page: string) => page;
    const piResults = buildSettingsSearchResults({
      query,
      runtimeCtx: { ...runtimeCtx, isPiKernel: true },
      t,
      getPageTitle,
    });
    const vsCodeResults = buildSettingsSearchResults({
      query,
      runtimeCtx: { ...runtimeCtx, isVSCode: true, isPiKernel: true },
      t,
      getPageTitle,
    });

    expect(piResults.some((result) => result.id === 'chat.session-goal')).toBe(true);
    expect(piResults.some((result) => result.id === 'chat.session-goal-budget')).toBe(true);
    expect(vsCodeResults.some((result) => result.id === 'chat.session-goal')).toBe(false);
    expect(vsCodeResults.some((result) => result.id === 'chat.session-goal-budget')).toBe(false);
  });

  test('shows Feature Plugins search on Pi and hides it on OpenCode', () => {
    const query = 'feature plugins';
    const getPageTitle = (page: string) => page;
    const piResults = buildSettingsSearchResults({
      query: 'plan',
      runtimeCtx: { ...runtimeCtx, isPiKernel: true },
      t,
      getPageTitle,
    });
    const openCodeResults = buildSettingsSearchResults({
      query,
      runtimeCtx,
      t,
      getPageTitle,
    });

    expect(piResults.some((result) => result.id === 'feature-plugins.plan')).toBe(true);
    expect(piResults.some((result) => result.id === 'feature-plugins.goal')).toBe(false);
    expect(openCodeResults.some((result) => result.page === 'feature-plugins')).toBe(false);
  });

  test('hides Settings MCP search on Pi unless the adapter slot is active', () => {
    const query = 'mcp';
    const getPageTitle = (page: string) => page;
    const hidden = buildSettingsSearchResults({
      query,
      runtimeCtx: { ...runtimeCtx, isPiKernel: true },
      t,
      getPageTitle,
    });
    const leftoverFilesDoNotMatter = buildSettingsSearchResults({
      query,
      runtimeCtx: { ...runtimeCtx, isPiKernel: true, isMcpFeaturePluginActive: false },
      t,
      getPageTitle,
    });
    const visible = buildSettingsSearchResults({
      query,
      runtimeCtx: { ...runtimeCtx, isPiKernel: true, isMcpFeaturePluginActive: true },
      t,
      getPageTitle,
    });
    const openCode = buildSettingsSearchResults({
      query,
      runtimeCtx,
      t,
      getPageTitle,
    });

    expect(hidden.some((result) => result.id.startsWith('mcp.'))).toBe(false);
    expect(leftoverFilesDoNotMatter.some((result) => result.id.startsWith('mcp.'))).toBe(false);
    expect(visible.some((result) => result.id === 'mcp.create')).toBe(true);
    expect(openCode.some((result) => result.id === 'mcp.create')).toBe(true);
    expect(hidden.some((result) => result.id === 'feature-plugins.mcp')).toBe(true);
  });
});
