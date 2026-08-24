import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveForkThinkingLevels } from './forkThinkingLevels';

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
    expect(source).not.toMatch(/grok|bmlab/);
  });
});
