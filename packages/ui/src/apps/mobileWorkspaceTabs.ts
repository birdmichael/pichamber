import type { FeaturePluginsPayload } from '@/components/sections/feature-plugins/featurePlugins';
import { isMcpSettingsAvailable } from '@/lib/settings/metadata';
import { resolvePlanRailEnabled } from '@/lib/surfaces/planRail';
import type { SessionPlan } from '@/sync/pi-session-plan';

const MOBILE_WORKSPACE_TABS = ['changes', 'files', 'terminal', 'notes', 'plan', 'mcp'] as const;

export type MobileWorkspaceTab = (typeof MOBILE_WORKSPACE_TABS)[number];

export const MOBILE_WORKSPACE_ALWAYS_TABS = ['changes', 'files', 'terminal', 'notes'] as const satisfies readonly MobileWorkspaceTab[];

type MobileWorkspaceTabGate = {
  isPiKernel: boolean;
  featurePlugins: FeaturePluginsPayload | null;
  plan: SessionPlan | null;
  planModeExperimentalEnabled: boolean;
  isMcpFeaturePluginActive?: boolean;
};

/** Same View Plan gate as the Desktop rail. Leftover `/health.planModeExperimentalEnabled` is OpenCode-only. */
export const isMobilePlanTabVisible = (options: MobileWorkspaceTabGate): boolean => (
  resolvePlanRailEnabled(options)
);

/** Same MCP gate as Desktop Settings MCP / Work Status MCP. */
export const isMobileMcpTabVisible = (
  options: Pick<MobileWorkspaceTabGate, 'isPiKernel' | 'isMcpFeaturePluginActive'>,
): boolean => (
  isMcpSettingsAvailable(options)
);

/**
 * Workspace tabs on hosted mobile / Capacitor. Plan is the Desktop `plan`
 * surface. MCP is a mobile-only pane and follows Settings MCP availability
 * (`isMcpSettingsAvailable` / Feature Plugin MCP). PR / Diff / Walkthrough
 * are not tabs. Git opens PR (and tablet Diff) with the Desktop
 * context-panel actions (`mobileWorkspaceReview.ts`). Phone file diffs stay
 * inline. Browser is unsupported.
 */
export const listVisibleMobileWorkspaceTabs = (options: MobileWorkspaceTabGate): MobileWorkspaceTab[] => {
  const tabs: MobileWorkspaceTab[] = ['changes', 'files', 'terminal', 'notes'];
  if (isMobilePlanTabVisible(options)) {
    tabs.push('plan');
  }
  if (isMobileMcpTabVisible(options)) {
    tabs.push('mcp');
  }
  return tabs;
};

export const fallbackMobileWorkspaceTab = (
  tab: MobileWorkspaceTab,
  visible: readonly MobileWorkspaceTab[],
): MobileWorkspaceTab => (
  visible.includes(tab) ? tab : (visible[0] ?? 'changes')
);
