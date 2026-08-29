import {
  parseFeaturePluginsPayload,
  type FeaturePluginSlot,
  type FeaturePluginsPayload,
} from '@/components/sections/feature-plugins/featurePlugins';

export const isFeaturePluginSlotActive = (
  payload: FeaturePluginsPayload | null | undefined,
  slot: FeaturePluginSlot,
): boolean => Boolean(payload?.slots[slot]?.installed && payload?.slots[slot]?.enabled);

export const parseFeaturePluginSlotActive = (
  value: unknown,
  slot: FeaturePluginSlot,
): boolean => {
  const parsed = parseFeaturePluginsPayload(value);
  return isFeaturePluginSlotActive(parsed, slot);
};

const FEATURE_PLUGIN_SLASH_SLOTS: Record<string, FeaturePluginSlot> = {
  run: 'subagents',
  plan: 'plan',
  goal: 'goal',
};

/** Load state for the Feature Plugins store. Idle/loading/failed must not
 *  turn `/plan` into a chat bubble while the slash menu already listed it. */
export type FeaturePluginLoadStatus = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * Whether a composer slash should POST session.command for a Feature Plugin.
 * `/btw` is excluded (client-owned). When the payload has not finished loading,
 * route `/plan` `/run` `/goal` as commands so a new-session first send cannot
 * become a leftover bubble. Once loaded, honour installed+enabled.
 */
export const shouldDispatchFeaturePluginSlash = (
  cmdName: string,
  payload: FeaturePluginsPayload | null | undefined,
  status: FeaturePluginLoadStatus = 'idle',
): boolean => {
  const slot = FEATURE_PLUGIN_SLASH_SLOTS[cmdName.trim().toLowerCase()];
  if (!slot) return false;
  if (status !== 'ready') return true;
  return isFeaturePluginSlotActive(payload, slot);
};
