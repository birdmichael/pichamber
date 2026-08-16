import { describe, expect, test } from 'bun:test';

import { emptyFeaturePluginsPayload } from '@/components/sections/feature-plugins/featurePlugins';
import { resolvePlanRailEnabled } from './planRail';

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
