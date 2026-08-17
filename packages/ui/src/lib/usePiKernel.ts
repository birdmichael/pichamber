import React from 'react';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { useFeaturePluginsStore } from '@/stores/useFeaturePluginsStore';

/** Matches the Pi facade synthetic default from GET /api/agent (`name: "pi"`). */
export const SYNTHETIC_PI_AGENT_NAME = 'pi';

/**
 * Session share, message revert, and composer / session.shell are OpenCode-only.
 * On Pi they are empty stubs and must not be offered as successful actions.
 */
export function canOfferOpenCodeSessionStub(isPiKernel: boolean): boolean {
  return !isPiKernel;
}

/**
 * Leftover OpenCode agent dropdowns (`sections/commands/AgentSelector` and
 * `multirun/AgentSelector`) imply extra agents. On Pi hide them when the
 * live list is only the synthetic `pi` row, or when the list is not yet
 * loaded. OpenCode keeps the pickers even for a one-item list.
 * Feature Plugins Subagents / Agent Manager pass `keepVisibleOnPi`.
 */
export function shouldShowOpenCodeAgentPicker(
  isPiKernel: boolean,
  selectableAgents?: ReadonlyArray<{ name: string }>,
): boolean {
  if (!isPiKernel) return true;
  if (!selectableAgents || selectableAgents.length === 0) return false;
  return selectableAgents.length !== 1 || selectableAgents[0]?.name !== SYNTHETIC_PI_AGENT_NAME;
}

/**
 * Pin a hidden leftover agent field to the synthetic Pi agent. OpenCode
 * keeps the caller value (empty means inherit / unset).
 */
export function resolvePinnedPiAgentName(isPiKernel: boolean, agent?: string | null): string {
  if (!isPiKernel) return (agent ?? '').trim();
  return SYNTHETIC_PI_AGENT_NAME;
}

/**
 * OpenChamber Session Goal stays hidden on the Pi kernel. The composer Goal
 * button is the installed `@narumitw/pi-goal` plugin, not this leftover.
 */
export function isSessionGoalVisibleOnPiKernel(isPiKernel: boolean): boolean {
  return !isPiKernel;
}

/**
 * Provider-quota Usage (`/api/quota/*`) is leftover OpenCode. Pi has no
 * quota source. Session tokens and cache read/write stay elsewhere.
 */
export function isProviderQuotaAvailable(isPiKernel: boolean): boolean {
  return !isPiKernel;
}

export function usePiKernel(): boolean {
  const [isPiKernel, setIsPiKernel] = React.useState(true);
  React.useEffect(() => {
    let cancelled = false;
    void runtimeFetch('/api/health', { method: 'GET' })
      .then((res) => res.ok ? res.json() : null)
      .then((payload) => {
        if (!cancelled && payload && typeof payload.kernel === 'string') {
          setIsPiKernel(payload.kernel === 'pi');
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  return isPiKernel;
}

/**
 * MCP Settings and Work Status follow the feature-plugin slot, not `!isPiKernel`.
 * OpenCode keeps MCP available. On Pi the slot must be installed and enabled.
 */
export function isMcpFeaturePluginAvailable(input: {
  isPiKernel?: boolean;
  isMcpFeaturePluginActive?: boolean;
}): boolean {
  if (!input.isPiKernel) return true;
  return Boolean(input.isMcpFeaturePluginActive);
}

export function useMcpFeaturePluginActive(): boolean {
  const isPiKernel = usePiKernel();
  const ensureLoaded = useFeaturePluginsStore((state) => state.ensureLoaded);
  const loadState = useFeaturePluginsStore((state) => state.loadState);
  React.useEffect(() => {
    if (isPiKernel) {
      void ensureLoaded();
    }
  }, [ensureLoaded, isPiKernel]);
  if (!isPiKernel) return true;
  return loadState.status === 'ready'
    && Boolean(loadState.payload.slots.mcp.installed && loadState.payload.slots.mcp.enabled);
}
