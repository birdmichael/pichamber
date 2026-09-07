import { describe, expect, test } from 'bun:test';

import { buildSubagentRunArguments, canLaunchSubagent, parseSubagentModelRef } from './subagentLaunch';

describe('subagent launch guard', () => {
  test('requires an explicit confirmed provider/model selection', () => {
    expect(canLaunchSubagent({ task: 'inspect', sessionId: 'session-1', model: 'provider/model', modelConfirmed: false })).toBe(false);
    expect(canLaunchSubagent({ task: 'inspect', sessionId: 'session-1', model: 'provider/model', modelConfirmed: true })).toBe(true);
    expect(canLaunchSubagent({ task: 'inspect', sessionId: 'session-1', model: '', modelConfirmed: true })).toBe(false);
    expect(canLaunchSubagent({ task: 'inspect', sessionId: '', model: 'provider/model', modelConfirmed: true })).toBe(false);
  });

  test('keeps provider and model ids separate for routing', () => {
    expect(parseSubagentModelRef('provider/model-name')).toEqual({ providerId: 'provider', modelId: 'model-name' });
    expect(parseSubagentModelRef('provider')).toBeNull();
  });

  test('builds a Pi-native model override and background run request', () => {
    expect(buildSubagentRunArguments({
      role: 'scout',
      providerId: 'kimi-coding',
      modelId: 'k3',
      thinking: 'high',
      task: 'Inspect "the README"',
    })).toBe('scout[model=kimi-coding/k3:high] "Inspect \\"the README\\"" --bg');
  });
});
