import { create } from 'zustand';
import { runtimeFetch } from '@/lib/runtime-fetch';
import {
  parseKimiUsagePayload,
  reconcileKimiUsageState,
  type KimiUsagePayload,
} from '@/lib/pi/kimi-usage';

type KimiUsageStore = {
  payload: KimiUsagePayload | null;
  error: string | null;
  isLoading: boolean;
  fetchUsage: () => Promise<void>;
  reset: () => void;
};

let fetchGeneration = 0;
let queuedRefresh = false;

export const useKimiUsageStore = create<KimiUsageStore>((set, get) => ({
  payload: null,
  error: null,
  isLoading: false,
  reset: () => {
    fetchGeneration += 1;
    queuedRefresh = false;
    set({ payload: null, error: null, isLoading: false });
  },
  fetchUsage: async () => {
    if (get().isLoading) {
      queuedRefresh = true;
      return;
    }
    const started = fetchGeneration;
    set({ isLoading: true });
    try {
      const response = await runtimeFetch('/api/pi/kimi-usage');
      if (started !== fetchGeneration) return;
      if (!response.ok) {
        set({
          ...reconcileKimiUsageState(get(), {
            type: 'fetch-error',
            message: `Kimi Code usage failed (${response.status})`,
          }),
          isLoading: false,
        });
      } else {
        const parsed = parseKimiUsagePayload(await response.json());
        if (started !== fetchGeneration) return;
        if (!parsed) {
          set({
            ...reconcileKimiUsageState(get(), {
              type: 'fetch-error',
              message: 'Kimi Code usage payload was invalid',
            }),
            isLoading: false,
          });
        } else {
          set({
            ...reconcileKimiUsageState(get(), { type: 'parsed', payload: parsed }),
            isLoading: false,
          });
        }
      }
    } catch (error) {
      if (started !== fetchGeneration) return;
      set({
        ...reconcileKimiUsageState(get(), {
          type: 'fetch-error',
          message: error instanceof Error ? error.message : 'Kimi Code usage request failed',
        }),
        isLoading: false,
      });
    }
    if (started !== fetchGeneration) return;
    if (queuedRefresh) {
      queuedRefresh = false;
      await get().fetchUsage();
    }
  },
}));
