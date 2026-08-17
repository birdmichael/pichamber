import { isPiPlanPluginAvailable } from '@/sync/pi-feature-plugins-store';
import { sessionPlanViewAvailable, type SessionPlan } from '@/sync/pi-session-plan';
import type { FeaturePluginsPayload } from '@/components/sections/feature-plugins/featurePlugins';
import type { ContextPanelMode, MainTab } from '@/stores/useUIStore';

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

/**
 * Plan docks beside chat. The shared per-directory `expanded` overlay is for
 * other context surfaces; Plan never uses it, including leftover persisted
 * `expanded: true` from Files / Diff / Git.
 */
export function isContextPanelExpandedForMode(
  mode: ContextPanelMode | null | undefined,
  expanded: boolean,
): boolean {
  return Boolean(expanded && mode != null && mode !== 'plan');
}

/**
 * Desktop Plan is a context-panel rail, not a leftover OpenCode main tab.
 * Callers that would have set `activeMainTab` to `plan` stay on chat.
 */
export function resolveDesktopActiveMainTab(tab: MainTab): MainTab {
  return tab === 'plan' ? 'chat' : tab;
}
