import { create } from 'zustand';
import { runtimeFetch } from '@/lib/runtime-fetch';
import {
  parseXaiUsagePayload,
  reconcileXaiUsageState,
  type XaiUsagePayload,
} from '@/lib/pi/xai-usage';

type XaiUsageStore = {
  payload: XaiUsagePayload | null;
  error: string | null;
  isLoading: boolean;
  fetchUsage: () => Promise<void>;
  reset: () => void;
};

let fetchGeneration = 0;
let queuedRefresh = false;

export const useXaiUsageStore = create<XaiUsageStore>((set, get) => ({
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
      const response = await runtimeFetch('/api/pi/xai-usage');
      if (started !== fetchGeneration) return;
      if (!response.ok) {
        set({
          ...reconcileXaiUsageState(get(), {
            type: 'fetch-error',
            message: `xAI usage failed (${response.status})`,
          }),
          isLoading: false,
        });
      } else {
        const parsed = parseXaiUsagePayload(await response.json());
        if (started !== fetchGeneration) return;
        if (!parsed) {
          set({
            ...reconcileXaiUsageState(get(), {
              type: 'fetch-error',
              message: 'xAI usage payload was invalid',
            }),
            isLoading: false,
          });
        } else {
          set({
            ...reconcileXaiUsageState(get(), { type: 'parsed', payload: parsed }),
            isLoading: false,
          });
        }
      }
    } catch (error) {
      if (started !== fetchGeneration) return;
      set({
        ...reconcileXaiUsageState(get(), {
          type: 'fetch-error',
          message: error instanceof Error ? error.message : 'xAI usage request failed',
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
