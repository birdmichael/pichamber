import { create } from 'zustand';
import { runtimeFetch } from '@/lib/runtime-fetch';
import {
  type FeaturePluginSlot,
  type FeaturePluginsPayload,
  parseFeaturePluginsPayload,
} from '@/components/sections/feature-plugins/featurePlugins';

type FeaturePluginsLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; payload: FeaturePluginsPayload }
  | { status: 'error' };

interface FeaturePluginsStore {
  loadState: FeaturePluginsLoadState;
  applyPayload: (payload: FeaturePluginsPayload) => void;
  ensureLoaded: () => Promise<void>;
  isSlotActive: (slot: FeaturePluginSlot) => boolean;
}

const isActiveSlot = (payload: FeaturePluginsPayload | null | undefined, slot: FeaturePluginSlot): boolean => {
  const entry = payload?.slots[slot];
  return Boolean(entry?.installed && entry.enabled);
};

export const useFeaturePluginsStore = create<FeaturePluginsStore>()((set, get) => ({
  loadState: { status: 'idle' },

  applyPayload: (payload) => {
    set({ loadState: { status: 'ready', payload } });
  },

  ensureLoaded: async () => {
    const current = get().loadState;
    if (current.status === 'loading') return;
    if (current.status !== 'ready') {
      set({ loadState: { status: 'loading' } });
    }
    try {
      const response = await runtimeFetch('/api/pi/feature-plugins', {
        headers: { Accept: 'application/json' },
      });
      const parsed = parseFeaturePluginsPayload(await response.json().catch(() => null));
      if (!response.ok || !parsed) {
        set((state) => (
          state.loadState.status === 'ready'
            ? state
            : { loadState: { status: 'error' } }
        ));
        return;
      }
      set({ loadState: { status: 'ready', payload: parsed } });
    } catch {
      set((state) => (
        state.loadState.status === 'ready'
          ? state
          : { loadState: { status: 'error' } }
      ));
    }
  },

  isSlotActive: (slot) => {
    const { loadState } = get();
    return loadState.status === 'ready' && isActiveSlot(loadState.payload, slot);
  },
}));

export const isMcpFeaturePluginActiveFromState = (
  loadState: FeaturePluginsLoadState,
): boolean => loadState.status === 'ready' && isActiveSlot(loadState.payload, 'mcp');
