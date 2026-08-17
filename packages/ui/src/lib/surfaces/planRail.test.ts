import { describe, expect, test } from 'bun:test';

import { emptyFeaturePluginsPayload } from '@/components/sections/feature-plugins/featurePlugins';
import {
  isContextPanelExpandedForMode,
  resolveDesktopActiveMainTab,
  resolvePlanRailEnabled,
  resolvePlanViewKind,
} from './planRail';

const plugins = (installed: boolean, enabled: boolean) => {
  const payload = emptyFeaturePluginsPayload();
  payload.slots.plan.installed = installed;
  payload.slots.plan.enabled = enabled;
  return payload;
};

describe('resolvePlanRailEnabled', () => {
  test('on Pi requires the Plan plugin and a live Plan session, including empty active plans', () => {
    expect(resolvePlanRailEnabled({
      isPiKernel: true,
      featurePlugins: plugins(true, true),
      plan: { status: 'ready', planMarkdown: '# Plan' },
      planModeExperimentalEnabled: false,
    })).toBe(true);
    expect(resolvePlanRailEnabled({
      isPiKernel: true,
      featurePlugins: plugins(true, true),
      plan: { status: 'active', planMarkdown: '' },
      planModeExperimentalEnabled: true,
    })).toBe(true);
    expect(resolvePlanRailEnabled({
      isPiKernel: true,
      featurePlugins: plugins(true, true),
      plan: { status: 'off', planMarkdown: '' },
      planModeExperimentalEnabled: true,
    })).toBe(false);
    expect(resolvePlanRailEnabled({
      isPiKernel: true,
      featurePlugins: plugins(false, false),
      plan: { status: 'ready', planMarkdown: '# Plan' },
      planModeExperimentalEnabled: true,
    })).toBe(false);
  });

  test('on OpenCode keeps the experimental plan-mode flag', () => {
    expect(resolvePlanRailEnabled({
      isPiKernel: false,
      featurePlugins: null,
      plan: null,
      planModeExperimentalEnabled: true,
    })).toBe(true);
    expect(resolvePlanRailEnabled({
      isPiKernel: false,
      featurePlugins: plugins(true, true),
      plan: { status: 'ready', planMarkdown: '# Plan' },
      planModeExperimentalEnabled: false,
    })).toBe(false);
  });
});

describe('isContextPanelExpandedForMode', () => {
  test('Plan never uses the expanded overlay, including leftover expanded state', () => {
    expect(isContextPanelExpandedForMode('plan', true)).toBe(false);
    expect(isContextPanelExpandedForMode('plan', false)).toBe(false);
  });

  test('other surfaces still honor the shared expanded flag', () => {
    expect(isContextPanelExpandedForMode('file', true)).toBe(true);
    expect(isContextPanelExpandedForMode('diff', true)).toBe(true);
    expect(isContextPanelExpandedForMode('git', false)).toBe(false);
    expect(isContextPanelExpandedForMode(null, true)).toBe(false);
  });
});

describe('resolveDesktopActiveMainTab', () => {
  test('maps leftover OpenCode plan main tab to chat and leaves other tabs alone', () => {
    expect(resolveDesktopActiveMainTab('plan')).toBe('chat');
    expect(resolveDesktopActiveMainTab('chat')).toBe('chat');
    expect(resolveDesktopActiveMainTab('terminal')).toBe('terminal');
    expect(resolveDesktopActiveMainTab('diagram')).toBe('diagram');
  });
});

describe('resolvePlanViewKind', () => {
  test('uses the Pi session plan view without waiting on Feature Plugins', () => {
    expect(resolvePlanViewKind({ isPiKernel: true, targetPath: null })).toBe('pi-session');
    expect(resolvePlanViewKind({ isPiKernel: true, targetPath: '' })).toBe('pi-session');
    expect(resolvePlanViewKind({ isPiKernel: true, targetPath: '/repo/.opencode/plans/1.md' })).toBe('opencode');
    expect(resolvePlanViewKind({ isPiKernel: false, targetPath: null })).toBe('opencode');
  });
});
