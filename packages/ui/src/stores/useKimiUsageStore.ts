import { create } from 'zustand';
import { runtimeFetch } from '@/lib/runtime-fetch';
import {
  parseKimiUsagePayload,
  reconcileKimiUsageState,
  type KimiUsagePayload,
} from '@/lib/pi/kimi-usage';

export type KimiUsageEntry = {
  payload: KimiUsagePayload | null;
  error: string | null;
  isLoading: boolean;
};

const DEFAULT_KIMI_USAGE_ID = 'kimi-coding';
const emptyEntry = (): KimiUsageEntry => ({ payload: null, error: null, isLoading: false });

type KimiUsageStore = {
  payload: KimiUsagePayload | null;
  error: string | null;
  isLoading: boolean;
  byId: Record<string, KimiUsageEntry>;
  fetchUsage: (providerId?: string) => Promise<void>;
  reset: () => void;
};

let fetchGeneration = 0;
const queuedIds = new Set<string>();

const resolveUsageId = (providerId?: string): string => {
  const id = typeof providerId === 'string' ? providerId.trim() : '';
  return id || DEFAULT_KIMI_USAGE_ID;
};

export const useKimiUsageStore = create<KimiUsageStore>((set, get) => ({
  payload: null,
  error: null,
  isLoading: false,
  byId: {},
  reset: () => {
    fetchGeneration += 1;
    queuedIds.clear();
    set({ payload: null, error: null, isLoading: false, byId: {} });
  },
  fetchUsage: async (providerId) => {
    const id = resolveUsageId(providerId);
    const current = get().byId[id] ?? emptyEntry();
    if (current.isLoading) {
      queuedIds.add(id);
      return;
    }
    const started = fetchGeneration;
    set((state) => ({
      byId: { ...state.byId, [id]: { ...current, isLoading: true } },
      ...(id === DEFAULT_KIMI_USAGE_ID ? { isLoading: true } : {}),
    }));
    const apply = (entry: KimiUsageEntry) => {
      set((state) => ({
        byId: { ...state.byId, [id]: entry },
        ...(id === DEFAULT_KIMI_USAGE_ID
          ? { payload: entry.payload, error: entry.error, isLoading: entry.isLoading }
          : {}),
      }));
    };
    try {
      const query = id === DEFAULT_KIMI_USAGE_ID ? '' : `?providerId=${encodeURIComponent(id)}`;
      const response = await runtimeFetch(`/api/pi/kimi-usage${query}`);
      if (started !== fetchGeneration) return;
      if (!response.ok) {
        apply({
          ...reconcileKimiUsageState(current, {
            type: 'fetch-error',
            message: `Kimi Code usage failed (${response.status})`,
          }),
          isLoading: false,
        });
      } else {
        const parsed = parseKimiUsagePayload(await response.json());
        if (started !== fetchGeneration) return;
        if (!parsed) {
          apply({
            ...reconcileKimiUsageState(current, {
              type: 'fetch-error',
              message: 'Kimi Code usage payload was invalid',
            }),
            isLoading: false,
          });
        } else {
          apply({
            ...reconcileKimiUsageState(current, { type: 'parsed', payload: parsed }),
            isLoading: false,
          });
        }
      }
    } catch (error) {
      if (started !== fetchGeneration) return;
      apply({
        ...reconcileKimiUsageState(current, {
          type: 'fetch-error',
          message: error instanceof Error ? error.message : 'Kimi Code usage request failed',
        }),
        isLoading: false,
      });
    }
    if (started !== fetchGeneration) return;
    if (queuedIds.has(id)) {
      queuedIds.delete(id);
      await get().fetchUsage(id);
    }
  },
}));
