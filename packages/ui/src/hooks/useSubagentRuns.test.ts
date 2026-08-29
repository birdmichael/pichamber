import { describe, expect, test } from 'bun:test';

import { subagentRunsRequestHeaders } from './useSubagentRuns';

describe('subagentRunsRequestHeaders', () => {
  test('sends the parent session directory header and does not invent a current-project fallback', () => {
    expect(subagentRunsRequestHeaders('/repo')).toEqual({
      Accept: 'application/json',
      'x-opencode-directory': '/repo',
    });
    expect(subagentRunsRequestHeaders(null)).toEqual({
      Accept: 'application/json',
    });
    expect(subagentRunsRequestHeaders('')).toEqual({
      Accept: 'application/json',
    });
  });
});
