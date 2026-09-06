import { describe, expect, it } from 'vitest';

import {
  enrichKnownModelEntry,
  lookupKnownReasoning,
  lookupKnownVisionInput,
} from './known-model-capabilities.js';

describe('known-model-capabilities', () => {
  it('treats GPT-5.5/5.6/6 proxy ids as vision and reasoning models', () => {
    expect(lookupKnownReasoning('gpt-6-astra')).toBe(true);
    expect(lookupKnownReasoning('openai/gpt-6-astra')).toBe(true);
    expect(lookupKnownReasoning('gpt-5.6-terra')).toBe(true);
    expect(lookupKnownReasoning('gpt-5.6-sol')).toBe(true);
    expect(lookupKnownReasoning('gpt-5.5')).toBe(true);
    expect(lookupKnownReasoning('gpt-5.5-openai-compact')).toBe(true);
    expect(lookupKnownVisionInput('gpt-6-astra')).toEqual(['text', 'image']);
    expect(lookupKnownVisionInput('gpt-5.6-terra')).toEqual(['text', 'image']);
  });

  it('does not invent capabilities for unknown ids', () => {
    expect(lookupKnownReasoning('mystery-llm')).toBeUndefined();
    expect(lookupKnownReasoning('gpt-4o')).toBeUndefined();
    expect(lookupKnownVisionInput('mystery-llm')).toBeUndefined();
  });

  it('fills reasoning onto a skinny stored GPT-6 row', () => {
    expect(enrichKnownModelEntry('gpt-6-astra', { id: 'gpt-6-astra', name: 'gpt-6-astra' })).toEqual({
      changed: true,
      model: {
        id: 'gpt-6-astra',
        name: 'gpt-6-astra',
        input: ['text', 'image'],
        reasoning: true,
      },
    });
  });
});
