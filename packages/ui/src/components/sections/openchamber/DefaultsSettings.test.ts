import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'bun:test';
import { clampPiThinkingLevel } from '@/components/chat/piThinking';
import { resolveCatalogThinkingLevels } from '@/lib/model-catalog-capabilities';
import {
  filterPiEnabledModelsToCatalog,
  pickPiSessionDefaultModel,
} from './piSessionDefaultsDisplay';

const threeLevelMetadata = {
  reasoning: true,
  reasoning_options: [{ type: 'effort' as const, values: ['low', 'medium', 'high'] }],
};

// Mirrors DefaultsSettings.clampSessionDefaultThinkingLevel: empty catalog
// must not go through resolveVisiblePiThinkingLevels (that falls back to 7).
const clampSessionDefaultThinkingLevel = (
  current: string,
  availableLevels: readonly string[],
) => {
  if (availableLevels.length === 0) return undefined;
  return clampPiThinkingLevel(current, availableLevels);
};

describe('Session Defaults thinking levels', () => {
  test('lists catalog levels for the selected default model', () => {
    expect(resolveCatalogThinkingLevels(threeLevelMetadata)).toEqual([
      'low',
      'medium',
      'high',
    ]);
  });

  test('returns no levels when the selected model has none', () => {
    expect(resolveCatalogThinkingLevels({ reasoning: true })).toEqual([]);
    expect(resolveCatalogThinkingLevels(undefined)).toEqual([]);
  });

  test('does not invent the seven-level fallback when the catalog is silent', () => {
    const levels = resolveCatalogThinkingLevels({ reasoning: true });
    expect(levels).toEqual([]);
    expect(clampSessionDefaultThinkingLevel('xhigh', levels)).toBe(undefined);
    // clampPiThinkingLevel([]) treats empty as "unknown" and falls back to all
    // seven, so a stale xhigh would stay selected. Session Defaults must not.
    expect(clampPiThinkingLevel('xhigh', levels)).toBe('xhigh');
  });

  test('clamps a stale xhigh onto a 3-level model', () => {
    expect(clampSessionDefaultThinkingLevel('xhigh', ['low', 'medium', 'high'])).toBe('medium');
    expect(clampSessionDefaultThinkingLevel('high', ['low', 'medium', 'high'])).toBe('high');
  });

  test('prefers resolvedModel over a stored example-provider placeholder', () => {
    const catalog = ['kimi-coding/k3', 'bmlab-grok/grok-4.6'];
    expect(pickPiSessionDefaultModel(
      'example-provider/example-model',
      'kimi-coding/k3',
      catalog,
    )).toBe('kimi-coding/k3');
    expect(pickPiSessionDefaultModel(
      'example-provider/example-model',
      'kimi-coding/k3',
      [],
    )).toBe('kimi-coding/k3');
  });

  test('keeps a stored default that is still in the live catalog', () => {
    expect(pickPiSessionDefaultModel(
      'bmlab-grok/grok-4.6',
      'kimi-coding/k3',
      ['kimi-coding/k3', 'bmlab-grok/grok-4.6'],
    )).toBe('bmlab-grok/grok-4.6');
  });

  test('drops leftover example-provider enabledModels so live catalog rows stay checked', () => {
    const catalog = ['kimi-coding/k3', 'bmlab-grok/grok-4.6'];
    expect(filterPiEnabledModelsToCatalog(
      ['example-provider/alpha', 'other/beta'],
      catalog,
    )).toEqual([]);
    expect(filterPiEnabledModelsToCatalog(
      ['example-provider/alpha', 'kimi-coding/k3'],
      catalog,
    )).toEqual(['kimi-coding/k3']);
  });

  test('Session Defaults picker maps catalog levels and hides when empty', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'DefaultsSettings.tsx'),
      'utf-8',
    );
    expect(source).toContain('resolveCatalogThinkingLevels');
    expect(source).toContain('getModelMetadata');
    expect(source).toContain('availableLevels.map');
    expect(source).toContain('availableLevels.length > 0');
    expect(source).toContain('clampSessionDefaultThinkingLevel');
    expect(source).toContain('pickPiSessionDefaultModel');
    expect(source).toContain('filterPiEnabledModelsToCatalog');
    expect(source).not.toContain('PI_THINKING_LEVELS.map');
    expect(source).not.toMatch(/import\s*\{[^}]*resolveVisiblePiThinkingLevels/);
  });
});
