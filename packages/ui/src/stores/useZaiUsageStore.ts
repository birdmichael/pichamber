import { create } from 'zustand';
import { runtimeFetch } from '@/lib/runtime-fetch';
import {
  parseZaiUsagePayload,
  reconcileZaiUsageState,
  type ZaiUsagePayload,
} from '@/lib/pi/zai-usage';

export type ZaiUsageEntry = {
  payload: ZaiUsagePayload | null;
  error: string | null;
  isLoading: boolean;
};

const DEFAULT_ZAI_USAGE_ID = 'zai';
const emptyEntry = (): ZaiUsageEntry => ({ payload: null, error: null, isLoading: false });

type ZaiUsageStore = {
  payload: ZaiUsagePayload | null;
  error: string | null;
  isLoading: boolean;
  byId: Record<string, ZaiUsageEntry>;
  fetchUsage: (providerId?: string) => Promise<void>;
  reset: () => void;
};

let fetchGeneration = 0;
const queuedIds = new Set<string>();

const resolveUsageId = (providerId?: string): string => {
  const id = typeof providerId === 'string' ? providerId.trim() : '';
  return id || DEFAULT_ZAI_USAGE_ID;
};

export const useZaiUsageStore = create<ZaiUsageStore>((set, get) => ({
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
      ...(id === DEFAULT_ZAI_USAGE_ID ? { isLoading: true } : {}),
    }));
    const apply = (entry: ZaiUsageEntry) => {
      set((state) => ({
        byId: { ...state.byId, [id]: entry },
        ...(id === DEFAULT_ZAI_USAGE_ID
          ? { payload: entry.payload, error: entry.error, isLoading: entry.isLoading }
          : {}),
      }));
    };
    try {
      const query = id === DEFAULT_ZAI_USAGE_ID ? '' : `?providerId=${encodeURIComponent(id)}`;
      const response = await runtimeFetch(`/api/pi/zai-usage${query}`);
      if (started !== fetchGeneration) return;
      if (!response.ok) {
        apply({
          ...reconcileZaiUsageState(current, {
            type: 'fetch-error',
            message: `Z.AI usage failed (${response.status})`,
          }),
          isLoading: false,
        });
      } else {
        const parsed = parseZaiUsagePayload(await response.json());
        if (started !== fetchGeneration) return;
        if (!parsed) {
          apply({
            ...reconcileZaiUsageState(current, {
              type: 'fetch-error',
              message: 'Z.AI usage payload was invalid',
            }),
            isLoading: false,
          });
        } else {
          apply({
            ...reconcileZaiUsageState(current, { type: 'parsed', payload: parsed }),
            isLoading: false,
          });
        }
      }
    } catch (error) {
      if (started !== fetchGeneration) return;
      apply({
        ...reconcileZaiUsageState(current, {
          type: 'fetch-error',
          message: error instanceof Error ? error.message : 'Z.AI usage request failed',
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
