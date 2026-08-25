import type { I18nKey } from '@/lib/i18n';

export const FEATURE_PLUGIN_SLOTS = ['goal', 'plan', 'mcp', 'subagents', 'btw', 'todo'] as const;

export type FeaturePluginSlot = (typeof FEATURE_PLUGIN_SLOTS)[number];

export const DEFAULT_FEATURE_PLUGIN_SOURCES: Record<FeaturePluginSlot, string> = {
  goal: 'npm:@narumitw/pi-goal',
  plan: 'npm:@narumitw/pi-plan-mode',
  mcp: 'npm:pi-mcp-adapter',
  subagents: 'npm:pi-subagents',
  btw: 'npm:@narumitw/pi-btw',
  todo: 'npm:@juicesharp/rpiv-todo',
};

const DEFAULT_FEATURE_PLUGIN_COMMANDS: Partial<Record<FeaturePluginSlot, string>> = {
  goal: 'goal',
  btw: 'btw',
};

export interface FeaturePluginSlotState {
  source: string;
  enabled: boolean;
  installed: boolean;
  command?: string;
  presets: Array<{ id: string; source: string }>;
}

export interface FeaturePluginsPayload {
  slots: Record<FeaturePluginSlot, FeaturePluginSlotState>;
}

export interface FeaturePluginsReloadResult {
  reloaded?: string[];
  skipped?: Array<{ sessionID: string; reason?: string }>;
}

export const FEATURE_PLUGIN_SLOT_COPY: Record<FeaturePluginSlot, {
  titleKey: I18nKey;
  infoKey: I18nKey;
  settingsItem: string;
}> = {
  goal: {
    titleKey: 'settings.featurePlugins.slot.goal.title',
    infoKey: 'settings.featurePlugins.slot.goal.info',
    settingsItem: 'feature-plugins.goal',
  },
  plan: {
    titleKey: 'settings.featurePlugins.slot.plan.title',
    infoKey: 'settings.featurePlugins.slot.plan.info',
    settingsItem: 'feature-plugins.plan',
  },
  mcp: {
    titleKey: 'settings.featurePlugins.slot.mcp.title',
    infoKey: 'settings.featurePlugins.slot.mcp.info',
    settingsItem: 'feature-plugins.mcp',
  },
  subagents: {
    titleKey: 'settings.featurePlugins.slot.subagents.title',
    infoKey: 'settings.featurePlugins.slot.subagents.info',
    settingsItem: 'feature-plugins.subagents',
  },
  btw: {
    titleKey: 'settings.featurePlugins.slot.btw.title',
    infoKey: 'settings.featurePlugins.slot.btw.info',
    settingsItem: 'feature-plugins.btw',
  },
  todo: {
    titleKey: 'settings.featurePlugins.slot.todo.title',
    infoKey: 'settings.featurePlugins.slot.todo.info',
    settingsItem: 'feature-plugins.todo',
  },
};

function emptyFeaturePluginSlot(slot: FeaturePluginSlot): FeaturePluginSlotState {
  const command = DEFAULT_FEATURE_PLUGIN_COMMANDS[slot];
  return {
    source: DEFAULT_FEATURE_PLUGIN_SOURCES[slot],
    enabled: false,
    installed: false,
    ...(command ? { command } : {}),
    presets: [{ id: 'default', source: DEFAULT_FEATURE_PLUGIN_SOURCES[slot] }],
  };
}

export function emptyFeaturePluginsPayload(): FeaturePluginsPayload {
  return {
    slots: Object.fromEntries(
      FEATURE_PLUGIN_SLOTS.map((slot) => [slot, emptyFeaturePluginSlot(slot)]),
    ) as FeaturePluginsPayload['slots'],
  };
}

export function parseFeaturePluginsPayload(value: unknown): FeaturePluginsPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const slots = (value as { slots?: unknown }).slots;
  if (!slots || typeof slots !== 'object' || Array.isArray(slots)) return null;
  const next = emptyFeaturePluginsPayload();
  for (const slot of FEATURE_PLUGIN_SLOTS) {
    const entry = (slots as Record<string, unknown>)[slot];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const record = entry as Record<string, unknown>;
    if (typeof record.source !== 'string' || typeof record.enabled !== 'boolean' || typeof record.installed !== 'boolean') {
      return null;
    }
    const presets = Array.isArray(record.presets)
      ? record.presets.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const preset = item as { id?: unknown; source?: unknown };
        if (typeof preset.id !== 'string' || typeof preset.source !== 'string') return [];
        return [{ id: preset.id, source: preset.source }];
      })
      : emptyFeaturePluginSlot(slot).presets;
    next.slots[slot] = {
      source: record.source,
      enabled: record.enabled,
      installed: record.installed,
      presets,
      ...(DEFAULT_FEATURE_PLUGIN_COMMANDS[slot] && typeof record.command === 'string'
        ? { command: record.command }
        : {}),
    };
  }
  return next;
}

export function presetSourceLabel(source: string): string {
  return source.replace(/^npm:/, '');
}

/** Default package name shown on the Feature Plugins card. Never a typed source. */
export function featurePluginPackageLabel(slot: FeaturePluginSlot): string {
  return presetSourceLabel(DEFAULT_FEATURE_PLUGIN_SOURCES[slot]);
}
