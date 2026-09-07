import { describe, expect, test } from 'bun:test';

import { canLaunchSubagent, parseSubagentModelRef } from './subagentLaunch';

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
});
