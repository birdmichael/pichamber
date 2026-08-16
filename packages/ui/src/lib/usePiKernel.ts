import React from 'react';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { useFeaturePluginsStore } from '@/stores/useFeaturePluginsStore';

/**
 * Session share, message revert, and composer / session.shell are OpenCode-only.
 * On Pi they are empty stubs and must not be offered as successful actions.
 */
export function canOfferOpenCodeSessionStub(isPiKernel: boolean): boolean {
  return !isPiKernel;
}

/**
 * OpenChamber Session Goal stays hidden on the Pi kernel. The composer Goal
 * button is the installed `@narumitw/pi-goal` plugin, not this leftover.
 */
export function isSessionGoalVisibleOnPiKernel(isPiKernel: boolean): boolean {
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
