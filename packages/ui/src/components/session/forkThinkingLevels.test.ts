import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  nextScheduledTaskThinkingVariant,
  persistScheduledTaskThinkingVariant,
  resolveForkThinkingLevels,
} from './forkThinkingLevels';

const threeLevelMetadata = {
  reasoning: true,
  reasoning_options: [{ type: 'effort' as const, values: ['low', 'medium', 'high'] }],
};

describe('resolveForkThinkingLevels', () => {
  test('uses live Pi catalog levels and ignores leftover variants', () => {
    expect(resolveForkThinkingLevels({
      isPiKernel: true,
      providerId: 'example',
      modelId: 'example-4.6',
      getModelMetadata: () => threeLevelMetadata,
      variantKeys: ['legacy'],
    })).toEqual(['low', 'medium', 'high']);
  });

  test('hides the row when the selected model has no levels', () => {
    expect(resolveForkThinkingLevels({
      isPiKernel: true,
      providerId: 'example',
      modelId: 'fast',
      getModelMetadata: () => ({ reasoning: true }),
      variantKeys: ['high'],
    })).toEqual([]);
  });

  test('keeps OpenCode variant keys off the Pi kernel', () => {
    expect(resolveForkThinkingLevels({
      isPiKernel: false,
      providerId: 'openai',
      modelId: 'gpt',
      getModelMetadata: () => undefined,
      variantKeys: ['low', 'high'],
    })).toEqual(['low', 'high']);
  });

  test('ForkSessionDialog maps catalog levels and hides when empty', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'ForkSessionDialog.tsx'),
      'utf-8',
    );
    expect(source).toContain('resolveForkThinkingLevels');
    expect(source).toContain('thinkingLevels.length > 0');
    expect(source).toContain('normal-case');
    expect(source).not.toMatch(/grok|bmlab/);
  });

  test('ScheduledTaskEditorDialog maps catalog levels and hides when empty', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'ScheduledTaskEditorDialog.tsx'),
      'utf-8',
    );
    expect(source).toContain('resolveForkThinkingLevels');
    expect(source).toContain('hasThinkingLevels');
    expect(source).toContain('thinkingLevels.map');
    expect(source).not.toMatch(/grok|bmlab/);
  });

  test('ScheduledTasksDialog shows saved model and thinking level', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'ScheduledTasksDialog.tsx'),
      'utf-8',
    );
    expect(source).toContain('formatTaskModel');
    expect(source).toContain('formatEffortLabel');
    expect(source).toContain('task.execution.variant');
    expect(source).toContain("t('chat.modelControls.modeValue.none')");
  });
});

describe('nextScheduledTaskThinkingVariant', () => {
  test('keeps a pin while the selected model is still unknown', () => {
    expect(nextScheduledTaskThinkingVariant({
      thinkingLevels: [],
      modelKnown: false,
      currentVariant: 'high',
    })).toBeUndefined();
  });

  test('clears a leftover pin once the model is known to have no levels', () => {
    expect(nextScheduledTaskThinkingVariant({
      thinkingLevels: [],
      modelKnown: true,
      currentVariant: 'high',
    })).toBe('');
  });

  test('does not rewrite a pin that is still in the catalog', () => {
    expect(nextScheduledTaskThinkingVariant({
      thinkingLevels: ['low', 'medium', 'high'],
      modelKnown: true,
      currentVariant: 'xhigh',
    })).toBeUndefined();
  });
});

describe('persistScheduledTaskThinkingVariant', () => {
  test('keeps an unanswered pin until the model is known', () => {
    expect(persistScheduledTaskThinkingVariant({
      thinkingLevels: [],
      modelKnown: false,
      currentVariant: 'high',
    })).toBe('high');
  });

  test('drops a pin that is not in the loaded catalog', () => {
    expect(persistScheduledTaskThinkingVariant({
      thinkingLevels: ['low', 'medium', 'high'],
      modelKnown: true,
      currentVariant: 'xhigh',
    })).toBeUndefined();
  });

  test('saves a catalog pin', () => {
    expect(persistScheduledTaskThinkingVariant({
      thinkingLevels: ['low', 'medium', 'high'],
      modelKnown: true,
      currentVariant: 'high',
    })).toBe('high');
  });
});
