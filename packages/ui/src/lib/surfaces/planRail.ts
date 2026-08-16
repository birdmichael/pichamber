import { isPiPlanPluginAvailable } from '@/sync/pi-feature-plugins-store';
import { sessionPlanViewAvailable, type SessionPlan } from '@/sync/pi-session-plan';
import type { FeaturePluginsPayload } from '@/components/sections/feature-plugins/featurePlugins';

export function resolvePlanRailEnabled(options: {
  isPiKernel: boolean;
  featurePlugins: FeaturePluginsPayload | null;
  plan: SessionPlan | null;
  planModeExperimentalEnabled: boolean;
}): boolean {
  if (options.isPiKernel) {
    return isPiPlanPluginAvailable(options.featurePlugins) && sessionPlanViewAvailable(options.plan);
  }
  return options.planModeExperimentalEnabled;
}
