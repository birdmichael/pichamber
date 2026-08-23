import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'bun:test';
import { clampPiThinkingLevel } from '@/components/chat/piThinking';
import {
  clampSessionDefaultThinkingLevel,
  resolveSessionDefaultThinkingLevels,
} from './DefaultsSettings';

const threeLevelMetadata = {
  reasoning: true,
  reasoning_options: [{ type: 'effort' as const, values: ['low', 'medium', 'high'] }],
};

describe('Session Defaults thinking levels', () => {
  test('lists catalog levels for the selected default model', () => {
    const getModelMetadata = (providerId: string, modelId: string) => {
      if (providerId === 'provider' && modelId === 'three-level') return threeLevelMetadata;
      return undefined;
    };

    expect(resolveSessionDefaultThinkingLevels('provider', 'three-level', getModelMetadata)).toEqual([
      'low',
      'medium',
      'high',
    ]);
  });

  test('returns no levels when the selected model has none', () => {
    expect(resolveSessionDefaultThinkingLevels('', '', () => ({ reasoning: true }))).toEqual([]);
    expect(resolveSessionDefaultThinkingLevels('openai', 'gpt-4', () => ({ reasoning: true }))).toEqual([]);
    expect(resolveSessionDefaultThinkingLevels('openai', 'gpt-4', () => undefined)).toEqual([]);
  });

  test('does not invent the seven-level fallback when the catalog is silent', () => {
    const levels = resolveSessionDefaultThinkingLevels('openai', 'gpt-4', () => ({ reasoning: true }));
    expect(levels).toEqual([]);
    expect(clampSessionDefaultThinkingLevel('xhigh', levels)).toBeUndefined();
    expect(clampPiThinkingLevel('xhigh', levels)).toBe('medium');
  });

  test('clamps a stale xhigh onto a 3-level model', () => {
    expect(clampSessionDefaultThinkingLevel('xhigh', ['low', 'medium', 'high'])).toBe('medium');
    expect(clampSessionDefaultThinkingLevel('high', ['low', 'medium', 'high'])).toBe('high');
  });

  test('Session Defaults picker maps catalog levels and hides when empty', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'DefaultsSettings.tsx'),
      'utf-8',
    );
    expect(source).toContain('resolveCatalogThinkingLevels');
    expect(source).toContain('availableLevels.map');
    expect(source).toContain('availableLevels.length > 0');
    expect(source).not.toContain('PI_THINKING_LEVELS.map');
    expect(source).not.toContain('resolveVisiblePiThinkingLevels');
  });
});
