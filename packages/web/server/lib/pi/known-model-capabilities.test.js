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

  it('hydrates any catalog-matched non-GPT model and keeps unknown ids skinny', () => {
    const catalog = {
      xai: {
        id: 'xai',
        models: {
          'grok-4.6': {
            id: 'grok-4.6',
            modalities: { input: ['text', 'image'] },
            reasoning: true,
          },
        },
      },
    };
    expect(enrichKnownModelEntry('grok-4.6', { id: 'grok-4.6' }, { catalog }).model).toMatchObject({
      input: ['text', 'image'],
      reasoning: true,
    });
    expect(enrichKnownModelEntry('mystery-llm', { id: 'mystery-llm' }, { catalog }).model).toEqual({ id: 'mystery-llm' });
  });

  it('uses catalog flags for GPT and falls back to known tables when catalog misses or is down', () => {
    const catalog = {
      openai: {
        id: 'openai',
        models: {
          'gpt-6-astra': {
            id: 'gpt-6-astra',
            modalities: { input: ['text', 'image'] },
            reasoning: true,
          },
        },
      },
    };
    expect(enrichKnownModelEntry('gpt-6-astra', { id: 'gpt-6-astra' }, { catalog }).model).toMatchObject({
      input: ['text', 'image'],
      reasoning: true,
    });
    expect(enrichKnownModelEntry('gpt-6-astra', { id: 'gpt-6-astra' }, { catalog: null }).model).toMatchObject({
      input: ['text', 'image'],
      reasoning: true,
    });
    // Catalog fetched but no row for this proxy slug → known prefix tables still apply.
    expect(enrichKnownModelEntry('gpt-6-astra', { id: 'gpt-6-astra' }, { catalog: { openai: { id: 'openai', models: {} } } }).model).toMatchObject({
      input: ['text', 'image'],
      reasoning: true,
    });
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

  it('hydrates DeepSeek V4.1 Flash Vision proxy ids via prefix even when catalog misses them', () => {
    const catalog = {
      deepseek: {
        id: 'deepseek',
        models: {
          'deepseek-v4-flash': {
            id: 'deepseek-v4-flash',
            reasoning: true,
          },
        },
      },
    };
    const id = 'deepseek-v4.1-flash-expires-on-0910';
    expect(lookupKnownReasoning(id)).toBe(true);
    expect(lookupKnownVisionInput(id)).toEqual(['text', 'image']);
    expect(enrichKnownModelEntry(id, { id, name: 'DeepSeek V4.1 Flash Vision' }, { catalog }).model).toMatchObject({
      input: ['text', 'image'],
      reasoning: true,
    });
  });

  it('treats a stored thinkingLevelMap as reasoning even without the flag', () => {
    expect(enrichKnownModelEntry('mystery-llm', {
      id: 'mystery-llm',
      thinkingLevelMap: { high: 'high', xhigh: 'xhigh' },
    }, { catalog: {} }).model).toMatchObject({
      reasoning: true,
      thinkingLevelMap: { high: 'high', xhigh: 'xhigh' },
    });
  });

});
