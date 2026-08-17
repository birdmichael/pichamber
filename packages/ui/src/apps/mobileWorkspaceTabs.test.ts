import { describe, expect, test } from 'bun:test';

import { emptyFeaturePluginsPayload } from '@/components/sections/feature-plugins/featurePlugins';
import { canShowPiPlanToggle } from '@/sync/pi-session-plan';
import { isPiGoalComposerButtonVisible } from '@/lib/piGoal';

import {
  fallbackMobileWorkspaceTab,
  isMobilePlanTabVisible,
  listVisibleMobileWorkspaceTabs,
  MOBILE_WORKSPACE_ALWAYS_TABS,
} from './mobileWorkspaceTabs';

const plugins = (installed: boolean, enabled: boolean) => {
  const payload = emptyFeaturePluginsPayload();
  payload.slots.plan.installed = installed;
  payload.slots.plan.enabled = enabled;
  return payload;
};

const goalPlugins = (installed: boolean, enabled: boolean) => {
  const payload = emptyFeaturePluginsPayload();
  payload.slots.goal.installed = installed;
  payload.slots.goal.enabled = enabled;
  return payload;
};

describe('mobile Plan tab visibility', () => {
  test('on Pi requires Feature Plugins Plan installed+enabled and a live plan status, including empty markdown', () => {
    expect(isMobilePlanTabVisible({
      isPiKernel: true,
      featurePlugins: plugins(true, true),
      plan: { status: 'ready', planMarkdown: '# Plan' },
      planModeExperimentalEnabled: false,
    })).toBe(true);
    expect(isMobilePlanTabVisible({
      isPiKernel: true,
      featurePlugins: plugins(true, true),
      plan: { status: 'active', planMarkdown: '' },
      planModeExperimentalEnabled: false,
    })).toBe(true);
    expect(isMobilePlanTabVisible({
      isPiKernel: true,
      featurePlugins: plugins(true, true),
      plan: { status: 'saved', planMarkdown: '' },
      planModeExperimentalEnabled: true,
    })).toBe(true);
    expect(isMobilePlanTabVisible({
      isPiKernel: true,
      featurePlugins: plugins(true, true),
      plan: { status: 'implementing', planMarkdown: '# Plan' },
      planModeExperimentalEnabled: false,
    })).toBe(true);

    expect(isMobilePlanTabVisible({
      isPiKernel: true,
      featurePlugins: plugins(true, true),
      plan: { status: 'off', planMarkdown: '' },
      planModeExperimentalEnabled: true,
    })).toBe(false);
    expect(isMobilePlanTabVisible({
      isPiKernel: true,
      featurePlugins: plugins(true, false),
      plan: { status: 'ready', planMarkdown: '# Plan' },
      planModeExperimentalEnabled: true,
    })).toBe(false);
    expect(isMobilePlanTabVisible({
      isPiKernel: true,
      featurePlugins: plugins(false, true),
      plan: { status: 'ready', planMarkdown: '# Plan' },
      planModeExperimentalEnabled: true,
    })).toBe(false);
    expect(isMobilePlanTabVisible({
      isPiKernel: true,
      featurePlugins: plugins(false, false),
      plan: { status: 'ready', planMarkdown: '# Plan' },
      planModeExperimentalEnabled: true,
    })).toBe(false);
    expect(isMobilePlanTabVisible({
      isPiKernel: true,
      featurePlugins: null,
      plan: { status: 'ready', planMarkdown: '# Plan' },
      planModeExperimentalEnabled: true,
    })).toBe(false);
  });

  test('on OpenCode keeps the leftover experimental plan-mode flag', () => {
    expect(isMobilePlanTabVisible({
      isPiKernel: false,
      featurePlugins: null,
      plan: null,
      planModeExperimentalEnabled: true,
    })).toBe(true);
    expect(isMobilePlanTabVisible({
      isPiKernel: false,
      featurePlugins: plugins(true, true),
      plan: { status: 'ready', planMarkdown: '# Plan' },
      planModeExperimentalEnabled: false,
    })).toBe(false);
  });

  test('never lists Browser, PR, Diff, or Walkthrough as workspace tabs', () => {
    const tabs = listVisibleMobileWorkspaceTabs({
      isPiKernel: true,
      featurePlugins: plugins(true, true),
      plan: { status: 'active', planMarkdown: '' },
      planModeExperimentalEnabled: false,
    });
    expect(tabs).toEqual(['changes', 'files', 'terminal', 'notes', 'plan', 'mcp']);
    expect((tabs as string[]).some((tab) => ['browser', 'pr', 'diff', 'walkthrough'].includes(tab))).toBe(false);
  });

  test('lists Plan between Notes and MCP only when the gate is on', () => {
    expect(listVisibleMobileWorkspaceTabs({
      isPiKernel: true,
      featurePlugins: plugins(true, true),
      plan: { status: 'active', planMarkdown: '' },
      planModeExperimentalEnabled: false,
    })).toEqual(['changes', 'files', 'terminal', 'notes', 'plan', 'mcp']);

    expect(listVisibleMobileWorkspaceTabs({
      isPiKernel: true,
      featurePlugins: plugins(true, true),
      plan: { status: 'off', planMarkdown: '' },
      planModeExperimentalEnabled: true,
    })).toEqual([...MOBILE_WORKSPACE_ALWAYS_TABS]);
  });

  test('falls back off Plan when the tab is no longer visible', () => {
    const hidden = listVisibleMobileWorkspaceTabs({
      isPiKernel: true,
      featurePlugins: plugins(false, false),
      plan: { status: 'off', planMarkdown: '' },
      planModeExperimentalEnabled: false,
    });
    expect(fallbackMobileWorkspaceTab('plan', hidden)).toBe('changes');
    expect(fallbackMobileWorkspaceTab('files', hidden)).toBe('files');
  });
});

describe('mobile composer Feature Plugin chrome', () => {
  test('Agent/Plan and Goal use Feature Plugin gates, not leftover planModeExperimentalEnabled', () => {
    expect(canShowPiPlanToggle(true, 'ses_1', false)).toBe(true);
    expect(canShowPiPlanToggle(true, null, true)).toBe(true);
    expect(canShowPiPlanToggle(false, 'ses_1', true)).toBe(false);

    expect(isPiGoalComposerButtonVisible({
      isPiKernel: true,
      payload: goalPlugins(true, true),
    })).toBe(true);
    expect(isPiGoalComposerButtonVisible({
      isPiKernel: true,
      payload: goalPlugins(true, false),
    })).toBe(false);
    expect(isPiGoalComposerButtonVisible({
      isPiKernel: false,
      payload: goalPlugins(true, true),
    })).toBe(false);
  });
});
