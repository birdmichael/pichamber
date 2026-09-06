import { describe, expect, test } from 'bun:test';
import { buildSubagentRunArguments, getSubagentRoleNames } from './subagentsComposerStrip';

describe('Subagents composer strip helpers', () => {
  test('merges Pi builtins with configured subagent agents and excludes parent Pi', () => {
    expect(getSubagentRoleNames([{ name: 'pi', mode: 'primary' }, { name: 'custom', mode: 'subagent' }, { name: 'hidden', hidden: true }])).toEqual(['custom', 'delegate', 'oracle', 'researcher', 'reviewer', 'scout', 'worker']);
  });
  test('passes selected model and thinking through the /run agent token', () => {
    expect(buildSubagentRunArguments({ role: 'worker', providerId: 'openai', modelId: 'gpt-5', thinking: 'high', task: 'Inspect the README' })).toBe('worker[model=openai/gpt-5:high] "Inspect the README"');
  });
});
