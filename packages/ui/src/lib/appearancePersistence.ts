import { useUIStore } from '@/stores/useUIStore';

export interface AppearancePreferences {
  showReasoningTraces?: boolean;
  collapsibleThinkingBlocks?: boolean;
  streamingAutoFollowEnabled?: boolean;
}

type RawAppearancePayload = {
  showReasoningTraces?: unknown;
  collapsibleThinkingBlocks?: unknown;
  streamingAutoFollowEnabled?: unknown;
};

const sanitizePreferences = (payload?: RawAppearancePayload | null): AppearancePreferences | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const result: AppearancePreferences = {};

  if (typeof payload.showReasoningTraces === 'boolean') {
    result.showReasoningTraces = payload.showReasoningTraces;
  }

  if (typeof payload.collapsibleThinkingBlocks === 'boolean') {
    result.collapsibleThinkingBlocks = payload.collapsibleThinkingBlocks;
  }

  if (typeof payload.streamingAutoFollowEnabled === 'boolean') {
    result.streamingAutoFollowEnabled = payload.streamingAutoFollowEnabled;
  }

  return Object.keys(result).length > 0 ? result : null;
};

const extractRawAppearance = (data: unknown): RawAppearancePayload | null => {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const candidate = data as Record<string, unknown>;
  const payload: RawAppearancePayload = {
    showReasoningTraces: candidate.showReasoningTraces,
    collapsibleThinkingBlocks: candidate.collapsibleThinkingBlocks,
    streamingAutoFollowEnabled: candidate.streamingAutoFollowEnabled,
  };

  return payload;
};

export const applyAppearancePreferences = (preferences: AppearancePreferences): void => {
  const store = useUIStore.getState();

  if (typeof preferences.showReasoningTraces === 'boolean') {
    store.setShowReasoningTraces(preferences.showReasoningTraces);
  }

  if (typeof preferences.collapsibleThinkingBlocks === 'boolean') {
    store.setCollapsibleThinkingBlocks(preferences.collapsibleThinkingBlocks);
  }

  if (typeof preferences.streamingAutoFollowEnabled === 'boolean') {
    store.setStreamingAutoFollowEnabled(preferences.streamingAutoFollowEnabled);
  }
};

export const loadAppearancePreferences = async (): Promise<AppearancePreferences | null> => {
  if (typeof window === 'undefined') {
    return null;
  }

  const stored = localStorage.getItem('appearance-preferences');
  if (!stored) {
    return null;
  }

  try {
    const data = JSON.parse(stored) as unknown;
    const payload = extractRawAppearance(data);
    return sanitizePreferences(payload);
  } catch (error) {
    console.warn('Failed to parse stored appearance preferences:', error);
    return null;
  }
};
