import type { FeaturePluginsPayload } from '@/components/sections/feature-plugins/featurePlugins';
import { resolvePlanRailEnabled } from '@/lib/surfaces/planRail';
import type { SessionPlan } from '@/sync/pi-session-plan';

const MOBILE_WORKSPACE_TABS = ['changes', 'files', 'terminal', 'notes', 'plan', 'mcp'] as const;

export type MobileWorkspaceTab = (typeof MOBILE_WORKSPACE_TABS)[number];

export const MOBILE_WORKSPACE_ALWAYS_TABS = ['changes', 'files', 'terminal', 'notes', 'mcp'] as const satisfies readonly MobileWorkspaceTab[];

type MobilePlanTabGate = {
  isPiKernel: boolean;
  featurePlugins: FeaturePluginsPayload | null;
  plan: SessionPlan | null;
  planModeExperimentalEnabled: boolean;
};

/** Same View Plan gate as the Desktop rail. Leftover `/health.planModeExperimentalEnabled` is OpenCode-only. */
export const isMobilePlanTabVisible = (options: MobilePlanTabGate): boolean => (
  resolvePlanRailEnabled(options)
);

/**
 * Workspace tabs on hosted mobile / Capacitor. Plan is the Desktop `plan`
 * surface; MCP stays a mobile-only pane until a later slice gates it.
 * PR / Diff / Walkthrough are not tabs. Git opens PR (and tablet Diff) with
 * the Desktop context-panel actions (`mobileWorkspaceReview.ts`). Phone file
 * diffs stay inline. Browser is unsupported.
 */
export const listVisibleMobileWorkspaceTabs = (options: MobilePlanTabGate): MobileWorkspaceTab[] => {
  const tabs: MobileWorkspaceTab[] = ['changes', 'files', 'terminal', 'notes'];
  if (isMobilePlanTabVisible(options)) {
    tabs.push('plan');
  }
  tabs.push('mcp');
  return tabs;
};

export const fallbackMobileWorkspaceTab = (
  tab: MobileWorkspaceTab,
  visible: readonly MobileWorkspaceTab[],
): MobileWorkspaceTab => (
  visible.includes(tab) ? tab : (visible[0] ?? 'changes')
);
