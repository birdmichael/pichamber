import { create } from 'zustand';

import {
  parseFeaturePluginsPayload,
  type FeaturePluginsPayload,
} from '@/components/sections/feature-plugins/featurePlugins';
import { runtimeFetch } from '@/lib/runtime-fetch';

type LoadState = 'idle' | 'loading' | 'ready' | 'failed';

type PiFeaturePluginsState = {
  payload: FeaturePluginsPayload | null;
  status: LoadState;
};

export const usePiFeaturePluginsStore = create<PiFeaturePluginsState>(() => ({
  payload: null,
  status: 'idle',
}));

export const resetPiFeaturePluginsStore = (): void => {
  usePiFeaturePluginsStore.setState({ payload: null, status: 'idle' });
};

export const applyFeaturePluginsPayload = (payload: FeaturePluginsPayload | null): void => {
  if (!payload) return;
  usePiFeaturePluginsStore.setState({ payload, status: 'ready' });
};

export const refreshFeaturePlugins = async (): Promise<FeaturePluginsPayload | null> => {
  const current = usePiFeaturePluginsStore.getState();
  if (current.status !== 'ready') {
    usePiFeaturePluginsStore.setState({ payload: current.payload, status: 'loading' });
  }
  try {
    const response = await runtimeFetch('/api/pi/feature-plugins', {
      headers: { Accept: 'application/json' },
    });
    const parsed = parseFeaturePluginsPayload(await response.json().catch(() => null));
    if (!response.ok || !parsed) {
      usePiFeaturePluginsStore.setState((state) => ({
        payload: state.payload,
        status: state.payload ? 'ready' : 'failed',
      }));
      return null;
    }
    applyFeaturePluginsPayload(parsed);
    return parsed;
  } catch {
    usePiFeaturePluginsStore.setState((state) => ({
      payload: state.payload,
      status: state.payload ? 'ready' : 'failed',
    }));
    return null;
  }
};

export const isPiPlanPluginAvailable = (payload: FeaturePluginsPayload | null | undefined): boolean => (
  Boolean(payload?.slots.plan.installed && payload.slots.plan.enabled)
);

export const usePiPlanPluginAvailable = (): boolean => (
  usePiFeaturePluginsStore((state) => isPiPlanPluginAvailable(state.payload))
);

const isPiSubagentsPluginAvailable = (payload: FeaturePluginsPayload | null | undefined): boolean => (
  Boolean(payload?.slots.subagents.installed && payload.slots.subagents.enabled)
);

export const usePiSubagentsPluginAvailable = (): boolean => (
  usePiFeaturePluginsStore((state) => isPiSubagentsPluginAvailable(state.payload))
);

const isPiBtwPluginAvailable = (payload: FeaturePluginsPayload | null | undefined): boolean => (
  Boolean(payload?.slots.btw.installed && payload.slots.btw.enabled)
);

export const usePiBtwPluginAvailable = (): boolean => (
  usePiFeaturePluginsStore((state) => isPiBtwPluginAvailable(state.payload))
);
