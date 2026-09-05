import { create } from 'zustand';
import { runtimeFetch } from '@/lib/runtime-fetch';
import {
  parseXaiUsagePayload,
  reconcileXaiUsageState,
  type XaiUsagePayload,
} from '@/lib/pi/xai-usage';

export type XaiUsageEntry = {
  payload: XaiUsagePayload | null;
  error: string | null;
  isLoading: boolean;
};

const DEFAULT_XAI_USAGE_ID = 'xai';
const emptyEntry = (): XaiUsageEntry => ({ payload: null, error: null, isLoading: false });

type XaiUsageStore = {
  payload: XaiUsagePayload | null;
  error: string | null;
  isLoading: boolean;
  byId: Record<string, XaiUsageEntry>;
  fetchUsage: (providerId?: string) => Promise<void>;
  reset: () => void;
};

let fetchGeneration = 0;
const queuedIds = new Set<string>();

const resolveUsageId = (providerId?: string): string => {
  const id = typeof providerId === 'string' ? providerId.trim() : '';
  return id || DEFAULT_XAI_USAGE_ID;
};

export const useXaiUsageStore = create<XaiUsageStore>((set, get) => ({
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
      ...(id === DEFAULT_XAI_USAGE_ID ? { isLoading: true } : {}),
    }));
    const apply = (entry: XaiUsageEntry) => {
      set((state) => ({
        byId: { ...state.byId, [id]: entry },
        ...(id === DEFAULT_XAI_USAGE_ID
          ? { payload: entry.payload, error: entry.error, isLoading: entry.isLoading }
          : {}),
      }));
    };
    try {
      const query = id === DEFAULT_XAI_USAGE_ID ? '' : `?providerId=${encodeURIComponent(id)}`;
      const response = await runtimeFetch(`/api/pi/xai-usage${query}`);
      if (started !== fetchGeneration) return;
      if (!response.ok) {
        apply({
          ...reconcileXaiUsageState(current, {
            type: 'fetch-error',
            message: `xAI usage failed (${response.status})`,
          }),
          isLoading: false,
        });
      } else {
        const parsed = parseXaiUsagePayload(await response.json());
        if (started !== fetchGeneration) return;
        if (!parsed) {
          apply({
            ...reconcileXaiUsageState(current, {
              type: 'fetch-error',
              message: 'xAI usage payload was invalid',
            }),
            isLoading: false,
          });
        } else {
          apply({
            ...reconcileXaiUsageState(current, { type: 'parsed', payload: parsed }),
            isLoading: false,
          });
        }
      }
    } catch (error) {
      if (started !== fetchGeneration) return;
      apply({
        ...reconcileXaiUsageState(current, {
          type: 'fetch-error',
          message: error instanceof Error ? error.message : 'xAI usage request failed',
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
