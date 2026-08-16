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
