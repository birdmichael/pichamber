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

  test('hides leftover Usage / quota search on Pi and keeps it on OpenCode', () => {
    const getPageTitle = (page: string) => page;
    const queries = ['usage', 'quota'] as const;
    for (const query of queries) {
      const piResults = buildSettingsSearchResults({
        query,
        runtimeCtx: { ...runtimeCtx, isPiKernel: true },
        t,
        getPageTitle,
      });
      const openCodeResults = buildSettingsSearchResults({
        query,
        runtimeCtx: { ...runtimeCtx, isPiKernel: false },
        t,
        getPageTitle,
      });

      expect(piResults.some((result) => result.page === 'usage')).toBe(false);
      expect(openCodeResults.some((result) => result.page === 'usage')).toBe(true);
    }
  });

  test('hides leftover Commands Override Agent search on Pi and keeps it on OpenCode', () => {
    const getPageTitle = (page: string) => page;
    const openCodeResults = buildSettingsSearchResults({
      query: 'override agent',
      runtimeCtx,
      t,
      getPageTitle,
    });
    const piOverrideResults = buildSettingsSearchResults({
      query: 'override agent',
      runtimeCtx: { ...runtimeCtx, isPiKernel: true },
      t,
      getPageTitle,
    });
    const piCommandsResults = buildSettingsSearchResults({
      query: 'commands',
      runtimeCtx: { ...runtimeCtx, isPiKernel: true },
      t,
      getPageTitle,
    });

    expect(openCodeResults.some((result) => result.id === 'commands.agent')).toBe(true);
    expect(piOverrideResults.some((result) => result.id === 'commands.agent')).toBe(false);
    expect(piCommandsResults.some((result) => result.page === 'commands')).toBe(true);
    expect(piCommandsResults.some((result) => result.id === 'commands.agent')).toBe(false);
    expect(piCommandsResults.some((result) => result.id === 'commands.model')).toBe(true);
  });

  test('hides leftover OpenCode Agents search on Pi and keeps it on OpenCode', () => {
    const leftoverAgentIds = [
      'agents.create',
      'agents.name',
      'agents.mode',
      'agents.model',
      'agents.variant',
      'agents.temperature',
      'agents.top-p',
      'agents.system-prompt',
      'agents.permissions',
    ] as const;
    const leftoverQueries = [
      { query: 'new agent', id: 'agents.create' },
      { query: 'primary', id: 'agents.mode' },
      { query: 'temperature', id: 'agents.temperature' },
      { query: 'system prompt', id: 'agents.system-prompt' },
      { query: 'permissions', id: 'agents.permissions' },
    ] as const;
    const getPageTitle = (page: string) => page;

    for (const { query, id } of leftoverQueries) {
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

      expect(openCodeResults.some((result) => result.id === id)).toBe(true);
      expect(piResults.some((result) => leftoverAgentIds.includes(result.id as typeof leftoverAgentIds[number]))).toBe(false);
      expect(piResults.some((result) => result.page === 'agents')).toBe(false);
    }
  });

  test('Pi Settings search for agents points at Feature Plugins and Session Defaults', () => {
    const getPageTitle = (page: string) => page;
    const piResults = buildSettingsSearchResults({
      query: 'agents',
      runtimeCtx: { ...runtimeCtx, isPiKernel: true },
      t,
      getPageTitle,
    });
    const openCodeResults = buildSettingsSearchResults({
      query: 'agents',
      runtimeCtx,
      t,
      getPageTitle,
    });

    expect(piResults.some((result) => result.page === 'agents')).toBe(false);
    expect(piResults.some((result) => result.id === 'feature-plugins.plan')).toBe(true);
    expect(piResults.some((result) => result.id === 'feature-plugins.subagents')).toBe(true);
    expect(piResults.some((result) => result.id === 'sessions.default-model')).toBe(true);
    expect(piResults.some((result) => result.id === 'sessions.default-thinking')).toBe(true);
    expect(openCodeResults.some((result) => result.id === 'agents.create')).toBe(true);
    expect(openCodeResults.some((result) => result.id === 'agents.mode')).toBe(true);
  });

  test('hides Session Goal settings on Pi and in VS Code', () => {
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

    expect(piResults.some((result) => result.id === 'chat.session-goal')).toBe(false);
    expect(piResults.some((result) => result.id === 'chat.session-goal-budget')).toBe(false);
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

  test('shows the Pichamber Web tool on Pi Desktop and hides it in VS Code', () => {
    const getPageTitle = (page: string) => page;
    const piDesktop = buildSettingsSearchResults({
      query: 'web tool',
      runtimeCtx: { ...runtimeCtx, isPiKernel: true, isVSCode: false },
      t,
      getPageTitle,
    });
    const piBrowser = buildSettingsSearchResults({
      query: 'browser',
      runtimeCtx: { ...runtimeCtx, isPiKernel: true, isVSCode: false },
      t,
      getPageTitle,
    });
    const vsCode = buildSettingsSearchResults({
      query: 'web tool',
      runtimeCtx: { ...runtimeCtx, isPiKernel: true, isVSCode: true },
      t,
      getPageTitle,
    });
    const leftoverOpenCode = buildSettingsSearchResults({
      query: 'web tool',
      runtimeCtx,
      t,
      getPageTitle,
    });
    const piBinary = buildSettingsSearchResults({
      query: 'OpenCode binary',
      runtimeCtx: { ...runtimeCtx, isPiKernel: true, isVSCode: false },
      t,
      getPageTitle,
    });

    expect(piDesktop.some((result) => result.id === 'sessions.agent-web-tool')).toBe(true);
    expect(piBrowser.some((result) => result.id === 'sessions.agent-web-tool')).toBe(true);
    expect(vsCode.some((result) => result.id === 'sessions.agent-web-tool')).toBe(false);
    expect(leftoverOpenCode.some((result) => result.id === 'sessions.agent-web-tool')).toBe(true);
    expect(piBinary.some((result) => result.id === 'sessions.opencode-binary')).toBe(false);
    expect(piBinary.some((result) => result.id === 'sessions.opencode-update-notifications')).toBe(false);
  });

  test('finds the Pi agent directory and update-notification rows on Pi', () => {
    const getPageTitle = (page: string) => page;
    const directory = buildSettingsSearchResults({
      query: 'agent directory',
      runtimeCtx: { ...runtimeCtx, isPiKernel: true, isVSCode: false },
      t,
      getPageTitle,
    });
    const env = buildSettingsSearchResults({
      query: 'PI_CODING_AGENT_DIR',
      runtimeCtx: { ...runtimeCtx, isPiKernel: true, isVSCode: false },
      t,
      getPageTitle,
    });
    const updates = buildSettingsSearchResults({
      query: 'update notifications',
      runtimeCtx: { ...runtimeCtx, isPiKernel: true, isVSCode: false },
      t,
      getPageTitle,
    });
    const leftover = buildSettingsSearchResults({
      query: 'agent directory',
      runtimeCtx: { ...runtimeCtx, isPiKernel: false, isVSCode: false },
      t,
      getPageTitle,
    });
    const vsCode = buildSettingsSearchResults({
      query: 'pi',
      runtimeCtx: { ...runtimeCtx, isPiKernel: true, isVSCode: true },
      t,
      getPageTitle,
    });

    expect(directory.some((result) => result.id === 'sessions.pi-agent-directory')).toBe(true);
    expect(env.some((result) => result.id === 'sessions.pi-agent-directory')).toBe(true);
    expect(updates.some((result) => result.id === 'sessions.pi-update-notifications')).toBe(true);
    expect(leftover.some((result) => result.id === 'sessions.pi-agent-directory')).toBe(false);
    expect(vsCode.some((result) => result.id === 'sessions.pi-agent-directory')).toBe(false);
  });

  test('shows the agent-control tool on Pi Desktop search and hides both tools in VS Code', () => {
    const getPageTitle = (page: string) => page;
    const piAgent = buildSettingsSearchResults({
      query: 'agent',
      runtimeCtx: { ...runtimeCtx, isPiKernel: true, isVSCode: false },
      t,
      getPageTitle,
    });
    const piScheduled = buildSettingsSearchResults({
      query: 'scheduled',
      runtimeCtx: { ...runtimeCtx, isPiKernel: true, isVSCode: false },
      t,
      getPageTitle,
    });
    const vsCode = buildSettingsSearchResults({
      query: 'agent',
      runtimeCtx: { ...runtimeCtx, isPiKernel: true, isVSCode: true },
      t,
      getPageTitle,
    });

    expect(piAgent.some((result) => result.id === 'sessions.agent-control-tool')).toBe(true);
    expect(piScheduled.some((result) => result.id === 'sessions.agent-control-tool')).toBe(true);
    expect(vsCode.some((result) => result.id === 'sessions.agent-control-tool')).toBe(false);
    expect(vsCode.some((result) => result.id === 'sessions.agent-web-tool')).toBe(false);
    expect(vsCode.some((result) => result.id === 'sessions.pi-agent-directory')).toBe(false);
  });

  test('lands Feature Plugins search on each slot card', () => {
    const getPageTitle = (page: string) => page;
    const queries = [
      { query: 'goal', id: 'feature-plugins.goal' },
      { query: '@narumitw/pi-plan-mode', id: 'feature-plugins.plan' },
      { query: 'pi-mcp-adapter', id: 'feature-plugins.mcp' },
      { query: 'pi-subagents', id: 'feature-plugins.subagents' },
    ] as const;

    for (const { query, id } of queries) {
      const results = buildSettingsSearchResults({
        query,
        runtimeCtx: { ...runtimeCtx, isPiKernel: true },
        t,
        getPageTitle,
      });
      expect(results.some((result) => result.id === id)).toBe(true);
    }
  });
});
