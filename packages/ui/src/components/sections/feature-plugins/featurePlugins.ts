import type { I18nKey } from '@/lib/i18n';

export const FEATURE_PLUGIN_SLOTS = ['goal', 'plan', 'mcp', 'subagents', 'btw', 'todo', 'xai', 'kimi'] as const;

export type FeaturePluginSlot = (typeof FEATURE_PLUGIN_SLOTS)[number];

export const DEFAULT_FEATURE_PLUGIN_SOURCES: Record<FeaturePluginSlot, string> = {
  goal: 'npm:@narumitw/pi-goal',
  plan: 'npm:@narumitw/pi-plan-mode',
  mcp: 'npm:pi-mcp-adapter',
  subagents: 'npm:pi-subagents',
  btw: 'npm:@narumitw/pi-btw',
  todo: 'npm:@juicesharp/rpiv-todo',
  xai: 'npm:pi-xai',
  kimi: 'npm:pi-kimi-code-console-usage',
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

/** Closed vocabulary of Pichamber chrome that can appear after a slot is installed. */
export const FEATURE_PLUGIN_UI_SURFACES = [
  'composer',
  'commands',
  'workStatus',
  'sidebar',
  'settings',
  'session',
] as const;

export type FeaturePluginUiSurface = (typeof FEATURE_PLUGIN_UI_SURFACES)[number];

const FEATURE_PLUGIN_UI_SURFACE_SET = new Set<string>(FEATURE_PLUGIN_UI_SURFACES);

export const FEATURE_PLUGIN_SURFACE_LABEL_KEY: Record<FeaturePluginUiSurface, I18nKey> = {
  composer: 'settings.featurePlugins.surface.composer',
  commands: 'settings.featurePlugins.surface.commands',
  workStatus: 'settings.featurePlugins.surface.workStatus',
  sidebar: 'settings.featurePlugins.surface.sidebar',
  settings: 'settings.featurePlugins.surface.settings',
  session: 'settings.featurePlugins.surface.session',
};

/** Hardcoded chrome tags per slot. New slots must register here; empty or unknown ids fail tests. */
export const FEATURE_PLUGIN_SLOT_UI_IMPACT: Record<FeaturePluginSlot, readonly FeaturePluginUiSurface[]> = {
  goal: ['composer', 'commands'],
  plan: ['composer', 'commands', 'sidebar', 'session'],
  mcp: ['workStatus', 'settings'],
  subagents: ['workStatus', 'commands', 'session'],
  btw: ['commands', 'session'],
  todo: ['workStatus'],
  xai: ['workStatus', 'settings', 'commands'],
  kimi: ['workStatus', 'settings', 'commands'],
};

const FEATURE_PLUGIN_SURFACE_TOOLTIP_KEY: Record<
  FeaturePluginSlot,
  Partial<Record<FeaturePluginUiSurface, I18nKey>>
> = {
  goal: {
    composer: 'settings.featurePlugins.slot.goal.surface.composer.tooltip',
    commands: 'settings.featurePlugins.slot.goal.surface.commands.tooltip',
  },
  plan: {
    composer: 'settings.featurePlugins.slot.plan.surface.composer.tooltip',
    commands: 'settings.featurePlugins.slot.plan.surface.commands.tooltip',
    sidebar: 'settings.featurePlugins.slot.plan.surface.sidebar.tooltip',
    session: 'settings.featurePlugins.slot.plan.surface.session.tooltip',
  },
  mcp: {
    workStatus: 'settings.featurePlugins.slot.mcp.surface.workStatus.tooltip',
    settings: 'settings.featurePlugins.slot.mcp.surface.settings.tooltip',
  },
  subagents: {
    workStatus: 'settings.featurePlugins.slot.subagents.surface.workStatus.tooltip',
    commands: 'settings.featurePlugins.slot.subagents.surface.commands.tooltip',
    session: 'settings.featurePlugins.slot.subagents.surface.session.tooltip',
  },
  btw: {
    commands: 'settings.featurePlugins.slot.btw.surface.commands.tooltip',
    session: 'settings.featurePlugins.slot.btw.surface.session.tooltip',
  },
  todo: {
    workStatus: 'settings.featurePlugins.slot.todo.surface.workStatus.tooltip',
  },
  xai: {
    workStatus: 'settings.featurePlugins.slot.xai.surface.workStatus.tooltip',
    settings: 'settings.featurePlugins.slot.xai.surface.settings.tooltip',
    commands: 'settings.featurePlugins.slot.xai.surface.commands.tooltip',
  },
  kimi: {
    workStatus: 'settings.featurePlugins.slot.kimi.surface.workStatus.tooltip',
    settings: 'settings.featurePlugins.slot.kimi.surface.settings.tooltip',
    commands: 'settings.featurePlugins.slot.kimi.surface.commands.tooltip',
  },
};

function featurePluginSurfaceSearchKeywords(surface: FeaturePluginUiSurface): readonly string[] {
  if (surface === 'workStatus') return ['work status', 'workStatus'];
  return [surface];
}

export function featurePluginSlotSearchKeywords(slot: FeaturePluginSlot): string[] {
  return FEATURE_PLUGIN_SLOT_UI_IMPACT[slot].flatMap((surface) => [...featurePluginSurfaceSearchKeywords(surface)]);
}

export function featurePluginSurfaceTooltipKey(
  slot: FeaturePluginSlot,
  surface: FeaturePluginUiSurface,
): I18nKey {
  const key = FEATURE_PLUGIN_SURFACE_TOOLTIP_KEY[slot][surface];
  if (!key) {
    throw new Error(`Feature plugin slot "${slot}" has no tooltip for surface "${surface}"`);
  }
  return key;
}

/** Fails when a slot has no tags or an unknown surface id. Used by tests and render. */
export function assertFeaturePluginUiImpact(
  slot: string,
  surfaces: readonly string[],
): asserts surfaces is readonly FeaturePluginUiSurface[] {
  if (!Array.isArray(surfaces) || surfaces.length === 0) {
    throw new Error(`Feature plugin slot "${slot}" must declare UI impact tags`);
  }
  const unknown = surfaces.filter((surface) => !FEATURE_PLUGIN_UI_SURFACE_SET.has(surface));
  if (unknown.length > 0) {
    throw new Error(`Feature plugin slot "${slot}" has unknown UI impact surface "${unknown[0]}"`);
  }
}

export function featurePluginSlotUiSurfaces(slot: FeaturePluginSlot): readonly FeaturePluginUiSurface[] {
  const surfaces = FEATURE_PLUGIN_SLOT_UI_IMPACT[slot];
  assertFeaturePluginUiImpact(slot, surfaces);
  return surfaces;
}

export const FEATURE_PLUGIN_SLOT_COPY: Record<FeaturePluginSlot, {
  titleKey: I18nKey;
  infoKey: I18nKey;
  infoHintKey?: I18nKey;
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
  xai: {
    titleKey: 'settings.featurePlugins.slot.xai.title',
    infoKey: 'settings.featurePlugins.slot.xai.info',
    infoHintKey: 'settings.featurePlugins.slot.xai.infoHint',
    settingsItem: 'feature-plugins.xai',
  },
  kimi: {
    titleKey: 'settings.featurePlugins.slot.kimi.title',
    infoKey: 'settings.featurePlugins.slot.kimi.info',
    infoHintKey: 'settings.featurePlugins.slot.kimi.infoHint',
    settingsItem: 'feature-plugins.kimi',
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
