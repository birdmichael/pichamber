import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_FEATURE_PLUGIN_SOURCES,
  FEATURE_PLUGIN_SLOT_COPY,
  FEATURE_PLUGIN_SLOT_UI_IMPACT,
  FEATURE_PLUGIN_SLOTS,
  FEATURE_PLUGIN_SURFACE_LABEL_KEY,
  FEATURE_PLUGIN_UI_SURFACES,
  assertFeaturePluginUiImpact,
  emptyFeaturePluginsPayload,
  featurePluginPackageLabel,
  featurePluginSlotSearchKeywords,
  featurePluginSlotUiSurfaces,
  featurePluginSurfaceTooltipKey,
  parseFeaturePluginsPayload,
  presetSourceLabel,
} from './featurePlugins';
import { dict as enDict } from '@/lib/i18n/messages/en';
import { dict as deDict } from '@/lib/i18n/messages/de';
import { dict as esDict } from '@/lib/i18n/messages/es';
import { dict as frDict } from '@/lib/i18n/messages/fr';
import { dict as jaDict } from '@/lib/i18n/messages/ja';
import { dict as koDict } from '@/lib/i18n/messages/ko';
import { dict as plDict } from '@/lib/i18n/messages/pl';
import { dict as ptBrDict } from '@/lib/i18n/messages/pt-BR';
import { dict as ukDict } from '@/lib/i18n/messages/uk';
import { dict as zhCnDict } from '@/lib/i18n/messages/zh-CN';
import { dict as zhTwDict } from '@/lib/i18n/messages/zh-TW';

const pageSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'FeaturePluginsPage.tsx'),
  'utf8',
);

describe('feature plugin payload parsing', () => {
  test('keeps default sources when building an empty payload', () => {
    const payload = emptyFeaturePluginsPayload();
    expect(payload.slots.goal.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.goal);
    expect(payload.slots.plan.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.plan);
    expect(payload.slots.mcp.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.mcp);
    expect(payload.slots.subagents.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.subagents);
    expect(payload.slots.btw.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.btw);
    expect(payload.slots.todo.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.todo);
    expect(payload.slots.todo.source).toBe('npm:@juicesharp/rpiv-todo');
    expect(payload.slots.xai.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.xai);
    expect(payload.slots.xai.source).toBe('npm:pi-xai');
    expect(payload.slots.kimi.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.kimi);
    expect(payload.slots.kimi.source).toBe('npm:pi-kimi-code-console-usage');
    expect(payload.slots.goal.installed).toBe(false);
    expect(payload.slots.goal.command).toBe('goal');
    expect(payload.slots.btw.command).toBe('btw');
    expect(payload.slots.todo.command).toEqual(undefined);
    expect(payload.slots.plan.command).toEqual(undefined);
  });

  test('rejects a failed or malformed payload instead of treating it as empty', () => {
    expect(parseFeaturePluginsPayload(null)).toBeNull();
    expect(parseFeaturePluginsPayload({ slots: {} })).toBeNull();
    expect(parseFeaturePluginsPayload({ slots: { goal: { source: 'npm:@narumitw/pi-goal' } } })).toBeNull();
  });

  test('accepts a complete eight-slot payload', () => {
    const parsed = parseFeaturePluginsPayload({
      slots: {
        goal: {
          source: 'npm:@narumitw/pi-goal',
          command: 'goal',
          enabled: true,
          installed: true,
          presets: [{ id: 'default', source: 'npm:@narumitw/pi-goal' }],
        },
        plan: { source: 'npm:@narumitw/pi-plan-mode', enabled: false, installed: false, presets: [] },
        mcp: { source: 'npm:pi-mcp-adapter', enabled: false, installed: false, presets: [] },
        subagents: { source: 'npm:pi-subagents', enabled: false, installed: false, presets: [] },
        btw: {
          source: 'npm:@narumitw/pi-btw',
          command: 'btw',
          enabled: true,
          installed: true,
          presets: [{ id: 'default', source: 'npm:@narumitw/pi-btw' }],
        },
        todo: {
          source: 'npm:@juicesharp/rpiv-todo',
          enabled: true,
          installed: true,
          presets: [{ id: 'default', source: 'npm:@juicesharp/rpiv-todo' }],
        },
        xai: {
          source: 'npm:pi-xai',
          enabled: true,
          installed: true,
          presets: [{ id: 'default', source: 'npm:pi-xai' }],
        },
        kimi: {
          source: 'npm:pi-kimi-code-console-usage',
          enabled: true,
          installed: true,
          presets: [{ id: 'default', source: 'npm:pi-kimi-code-console-usage' }],
        },
      },
    });
    expect(parsed?.slots.goal.installed).toBe(true);
    expect(parsed?.slots.btw.installed).toBe(true);
    expect(parsed?.slots.btw.command).toBe('btw');
    expect(parsed?.slots.todo.installed).toBe(true);
    expect(parsed?.slots.todo.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.todo);
    expect(parsed?.slots.plan.source).toBe(DEFAULT_FEATURE_PLUGIN_SOURCES.plan);
  });

  test('rejects a six-slot payload that omits xai', () => {
    expect(parseFeaturePluginsPayload({
      slots: {
        goal: { source: 'npm:@narumitw/pi-goal', enabled: false, installed: false, presets: [] },
        plan: { source: 'npm:@narumitw/pi-plan-mode', enabled: false, installed: false, presets: [] },
        mcp: { source: 'npm:pi-mcp-adapter', enabled: false, installed: false, presets: [] },
        subagents: { source: 'npm:pi-subagents', enabled: false, installed: false, presets: [] },
        btw: { source: 'npm:@narumitw/pi-btw', enabled: false, installed: false, presets: [] },
        todo: { source: 'npm:@juicesharp/rpiv-todo', enabled: false, installed: false, presets: [] },
      },
    })).toBeNull();
  });

  test('rejects a seven-slot payload that omits kimi', () => {
    expect(parseFeaturePluginsPayload({
      slots: {
        goal: { source: 'npm:@narumitw/pi-goal', enabled: false, installed: false, presets: [] },
        plan: { source: 'npm:@narumitw/pi-plan-mode', enabled: false, installed: false, presets: [] },
        mcp: { source: 'npm:pi-mcp-adapter', enabled: false, installed: false, presets: [] },
        subagents: { source: 'npm:pi-subagents', enabled: false, installed: false, presets: [] },
        btw: { source: 'npm:@narumitw/pi-btw', enabled: false, installed: false, presets: [] },
        todo: { source: 'npm:@juicesharp/rpiv-todo', enabled: false, installed: false, presets: [] },
        xai: { source: 'npm:pi-xai', enabled: false, installed: false, presets: [] },
      },
    })).toBeNull();
  });

  test('rejects a five-slot payload that omits todo', () => {
    expect(parseFeaturePluginsPayload({
      slots: {
        goal: { source: 'npm:@narumitw/pi-goal', enabled: false, installed: false, presets: [] },
        plan: { source: 'npm:@narumitw/pi-plan-mode', enabled: false, installed: false, presets: [] },
        mcp: { source: 'npm:pi-mcp-adapter', enabled: false, installed: false, presets: [] },
        subagents: { source: 'npm:pi-subagents', enabled: false, installed: false, presets: [] },
        btw: { source: 'npm:@narumitw/pi-btw', enabled: false, installed: false, presets: [] },
      },
    })).toBeNull();
  });

  test('rejects a four-slot payload that omits btw', () => {
    expect(parseFeaturePluginsPayload({
      slots: {
        goal: { source: 'npm:@narumitw/pi-goal', enabled: false, installed: false, presets: [] },
        plan: { source: 'npm:@narumitw/pi-plan-mode', enabled: false, installed: false, presets: [] },
        mcp: { source: 'npm:pi-mcp-adapter', enabled: false, installed: false, presets: [] },
        subagents: { source: 'npm:pi-subagents', enabled: false, installed: false, presets: [] },
      },
    })).toBeNull();
  });

  test('shows the default package name without the npm protocol prefix', () => {
    expect(presetSourceLabel('npm:@narumitw/pi-goal')).toBe('@narumitw/pi-goal');
    expect(featurePluginPackageLabel('goal')).toBe('@narumitw/pi-goal');
    expect(featurePluginPackageLabel('plan')).toBe('@narumitw/pi-plan-mode');
    expect(featurePluginPackageLabel('mcp')).toBe('pi-mcp-adapter');
    expect(featurePluginPackageLabel('subagents')).toBe('pi-subagents');
    expect(featurePluginPackageLabel('btw')).toBe('@narumitw/pi-btw');
    expect(featurePluginPackageLabel('todo')).toBe('@juicesharp/rpiv-todo');
    expect(featurePluginPackageLabel('xai')).toBe('pi-xai');
    expect(featurePluginPackageLabel('kimi')).toBe('pi-kimi-code-console-usage');
  });

  test('keeps Settings search IDs on the eight slot cards', () => {
    expect(FEATURE_PLUGIN_SLOTS.map((slot) => FEATURE_PLUGIN_SLOT_COPY[slot].settingsItem)).toEqual([
      'feature-plugins.goal',
      'feature-plugins.plan',
      'feature-plugins.mcp',
      'feature-plugins.subagents',
      'feature-plugins.btw',
      'feature-plugins.todo',
      'feature-plugins.xai',
      'feature-plugins.kimi',
    ]);
  });

  test('Feature Plugins page has no text inputs and anchors search on each card', () => {
    expect(pageSource.includes('<Input')).toBe(false);
    expect(pageSource.includes('SettingsChipGroup')).toBe(false);
    expect(pageSource.includes('settings.featurePlugins.field.source')).toBe(false);
    expect(pageSource.includes('settings.featurePlugins.field.command')).toBe(false);
    expect(pageSource.includes('@xl:grid-cols-2')).toBe(true);
    expect(/(?:^|[^@\w])(?:sm|lg):/.test(pageSource)).toBe(false);
    expect(pageSource.includes('data-settings-item={copy.settingsItem}')).toBe(true);
    expect(pageSource.includes('SettingsCheckboxRow')).toBe(false);
    expect(pageSource.includes('settings.featurePlugins.enabled')).toBe(false);
    expect(pageSource.includes('onEnabledChange')).toBe(false);
    expect(pageSource.includes('settings.featurePlugins.actions.reinstall')).toBe(false);
    expect(pageSource.includes('{saved.installed ? null : (')).toBe(true);
    expect(pageSource.includes('if (payload.slots[slot].installed) return;')).toBe(true);
    for (const slot of FEATURE_PLUGIN_SLOTS) {
      expect(FEATURE_PLUGIN_SLOT_COPY[slot].settingsItem).toBe(`feature-plugins.${slot}`);
    }
    expect(pageSource.includes('<FeaturePluginImpactTags slot={slot} />')).toBe(true);
    expect(FEATURE_PLUGIN_SLOT_COPY.xai.infoHintKey).toBe('settings.featurePlugins.slot.xai.infoHint');
    expect(FEATURE_PLUGIN_SLOT_COPY.kimi.infoHintKey).toBe('settings.featurePlugins.slot.kimi.infoHint');
    expect(enDict['settings.featurePlugins.slot.kimi.info']).toContain('Providers');
    expect(pageSource.includes('copy.infoHintKey')).toBe(true);
    expect(pageSource.indexOf('t(copy.infoKey)')).toBeLessThan(pageSource.indexOf('<FeaturePluginImpactTags slot={slot} />'));
    expect(pageSource.indexOf('<FeaturePluginImpactTags slot={slot} />')).toBeLessThan(pageSource.indexOf('featurePluginPackageLabel(slot)'));
    expect(pageSource.includes("pending?.action === 'install'")).toBe(true);
    expect(pageSource.includes('<FeaturePluginImpactTags slot={pending.slot} />')).toBe(true);
    expect(pageSource.includes('status-success')).toBe(true);
    expect(pageSource).toContain('mt-1 flex flex-wrap gap-1');
    expect(pageSource).toContain('rounded-md border border-[var(--interactive-border)] px-1.5 py-px typography-micro font-normal leading-none text-muted-foreground');
    expect(pageSource).not.toContain('rounded-full border border-[var(--interactive-border)] bg-[var(--surface-muted)]');
  });
});

describe('feature plugin UI impact tags', () => {
  test('registers a non-empty closed-vocabulary tag list for every slot', () => {
    expect(FEATURE_PLUGIN_SLOTS.map((slot) => slot in FEATURE_PLUGIN_SLOT_UI_IMPACT)).toEqual(
      FEATURE_PLUGIN_SLOTS.map(() => true),
    );
    for (const slot of FEATURE_PLUGIN_SLOTS) {
      const surfaces = featurePluginSlotUiSurfaces(slot);
      assertFeaturePluginUiImpact(slot, surfaces);
      expect(surfaces.length).toBeGreaterThan(0);
      for (const surface of surfaces) {
        expect(FEATURE_PLUGIN_UI_SURFACES).toContain(surface);
        expect(enDict[featurePluginSurfaceTooltipKey(slot, surface)]).toBeTruthy();
        expect(enDict[FEATURE_PLUGIN_SURFACE_LABEL_KEY[surface]]).toBeTruthy();
      }
    }
  });

  test('fails when a slot is missing tags or uses an unknown surface id', () => {
    expect(() => assertFeaturePluginUiImpact('ghost', [])).toThrow(/must declare UI impact tags/);
    expect(() => assertFeaturePluginUiImpact('goal', ['tui'])).toThrow(/unknown UI impact surface "tui"/);
    expect(() => featurePluginSurfaceTooltipKey('todo', 'commands')).toThrow(/no tooltip/);
  });

  test('keeps the closed slot-to-chrome map', () => {
    expect([...FEATURE_PLUGIN_SLOT_UI_IMPACT.goal]).toEqual(['composer', 'commands']);
    expect([...FEATURE_PLUGIN_SLOT_UI_IMPACT.plan]).toEqual(['composer', 'commands', 'sidebar', 'session']);
    expect([...FEATURE_PLUGIN_SLOT_UI_IMPACT.mcp]).toEqual(['workStatus', 'settings']);
    expect([...FEATURE_PLUGIN_SLOT_UI_IMPACT.subagents]).toEqual(['workStatus', 'commands', 'session']);
    expect([...FEATURE_PLUGIN_SLOT_UI_IMPACT.btw]).toEqual(['commands', 'session']);
    expect([...FEATURE_PLUGIN_SLOT_UI_IMPACT.todo]).toEqual(['workStatus']);

    expect(FEATURE_PLUGIN_SLOT_UI_IMPACT.goal).not.toContain('workStatus');
    expect(FEATURE_PLUGIN_SLOT_UI_IMPACT.goal).not.toContain('sidebar');
    expect(FEATURE_PLUGIN_SLOT_UI_IMPACT.goal).not.toContain('settings');
    expect(FEATURE_PLUGIN_SLOT_UI_IMPACT.goal).not.toContain('session');
    expect(FEATURE_PLUGIN_SLOT_UI_IMPACT.mcp).not.toContain('commands');
    expect(FEATURE_PLUGIN_SLOT_UI_IMPACT.mcp).not.toContain('composer');
    expect(FEATURE_PLUGIN_SLOT_UI_IMPACT.btw).not.toContain('composer');
    expect(FEATURE_PLUGIN_SLOT_UI_IMPACT.todo).toEqual(['workStatus']);
    expect([...FEATURE_PLUGIN_SLOT_UI_IMPACT.kimi]).toEqual(['workStatus', 'settings', 'commands']);
    expect(featurePluginSlotSearchKeywords('todo')).toEqual(['work status', 'workStatus']);
  });

  test('every locale has real surface labels and concrete chrome tooltips', () => {
    const locales = {
      de: deDict,
      es: esDict,
      fr: frDict,
      ja: jaDict,
      ko: koDict,
      pl: plDict,
      'pt-BR': ptBrDict,
      uk: ukDict,
      'zh-CN': zhCnDict,
      'zh-TW': zhTwDict,
    } as const;
    const labelKeys = FEATURE_PLUGIN_UI_SURFACES.map((surface) => FEATURE_PLUGIN_SURFACE_LABEL_KEY[surface]);

    expect(enDict['settings.featurePlugins.surface.composer']).toBe('Composer');
    expect(enDict['settings.featurePlugins.slot.goal.surface.composer.tooltip']).toBe('Composer Goal button');
    expect(zhCnDict['settings.featurePlugins.surface.composer']).toBe('输入框');
    expect(zhCnDict['settings.featurePlugins.slot.goal.surface.composer.tooltip']).toBe('输入框上的 Goal 按钮');

    for (const [locale, dictionary] of Object.entries(locales)) {
      for (const key of labelKeys) {
        expect(dictionary[key], `${locale} ${key}`).toBeTruthy();
        if (key !== 'settings.featurePlugins.surface.session' || locale !== 'fr') {
          expect(dictionary[key], `${locale} ${key}`).not.toBe(enDict[key]);
        }
      }
      for (const slot of FEATURE_PLUGIN_SLOTS) {
        for (const surface of FEATURE_PLUGIN_SLOT_UI_IMPACT[slot]) {
          const tooltipKey = featurePluginSurfaceTooltipKey(slot, surface);
          const tooltip = dictionary[tooltipKey];
          expect(tooltip, `${locale} ${tooltipKey}`).toBeTruthy();
          if (!tooltip.startsWith('/')) {
            expect(tooltip, `${locale} ${tooltipKey}`).not.toBe(enDict[tooltipKey]);
          }
        }
      }
    }
  });
});
