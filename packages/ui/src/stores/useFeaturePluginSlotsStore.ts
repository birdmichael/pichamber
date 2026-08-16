import React from 'react';
import { create } from 'zustand';

import {
  emptyFeaturePluginsPayload,
  parseFeaturePluginsPayload,
  type FeaturePluginSlot,
  type FeaturePluginsPayload,
} from '@/components/sections/feature-plugins/featurePlugins';
import { isFeaturePluginSlotActive } from '@/lib/featurePlugins/slotStatus';
import { runtimeFetch } from '@/lib/runtime-fetch';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

type FeaturePluginSlotsState = {
  status: LoadStatus;
  payload: FeaturePluginsPayload | null;
  apply: (payload: FeaturePluginsPayload) => void;
  load: (options?: { force?: boolean }) => Promise<void>;
};

let inFlight: Promise<void> | null = null;
let loadedAt = 0;
const CACHE_MS = 5000;

export const useFeaturePluginSlotsStore = create<FeaturePluginSlotsState>((set, get) => ({
  status: 'idle',
  payload: null,
  apply: (payload) => {
    loadedAt = Date.now();
    set({ status: 'ready', payload });
  },
  load: async (options = {}) => {
    if (inFlight) return inFlight;
    if (!options.force && get().status === 'ready' && Date.now() - loadedAt < CACHE_MS) {
      return;
    }
    if (!get().payload) set({ status: 'loading' });
    inFlight = runtimeFetch('/api/pi/feature-plugins', {
      headers: { Accept: 'application/json' },
    }).then(async (response) => {
      const parsed = parseFeaturePluginsPayload(await response.json().catch(() => null));
      if (!response.ok || !parsed) {
        set((current) => ({
          status: current.payload ? 'ready' : 'error',
        }));
        return;
      }
      loadedAt = Date.now();
      set({ status: 'ready', payload: parsed });
    }).catch(() => {
      set((current) => ({
        status: current.payload ? 'ready' : 'error',
      }));
    }).finally(() => {
      inFlight = null;
    });
    return inFlight;
  },
}));

export const useFeaturePluginSlotActive = (slot: FeaturePluginSlot, isPiKernel: boolean): boolean => {
  const payload = useFeaturePluginSlotsStore((state) => state.payload);
  const load = useFeaturePluginSlotsStore((state) => state.load);

  React.useEffect(() => {
    if (isPiKernel) void load();
  }, [isPiKernel, load]);

  if (!isPiKernel) return false;
  return isFeaturePluginSlotActive(payload ?? emptyFeaturePluginsPayload(), slot);
};
