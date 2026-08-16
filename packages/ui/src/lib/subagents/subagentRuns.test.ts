import { describe, expect, test } from 'bun:test';

import { parseSubagentRunsPayload } from './subagentRuns';

describe('parseSubagentRunsPayload', () => {
  test('keeps a valid adapter run and drops a malformed row', () => {
    const parsed = parseSubagentRunsPayload({
      runs: [
        {
          runId: 'run_1',
          parentID: 'ses_parent',
          sessionID: 'ses_child',
          name: 'scout',
          role: 'scout',
          mode: 'background',
          state: 'running',
          title: 'Inspect the repo',
          openable: true,
        },
        { runId: 'bad' },
      ],
    });
    expect(parsed).toEqual([{
      runId: 'run_1',
      parentID: 'ses_parent',
      sessionID: 'ses_child',
      name: 'scout',
      role: 'scout',
      mode: 'background',
      state: 'running',
      title: 'Inspect the repo',
      openable: true,
    }]);
  });

  test('does not treat fetch failure as an empty success', () => {
    expect(parseSubagentRunsPayload(null)).toBeNull();
    expect(parseSubagentRunsPayload({})).toBeNull();
  });

  test('marks a run without a session id as not openable', () => {
    const parsed = parseSubagentRunsPayload({
      runs: [{
        runId: 'run_early',
        parentID: 'ses_parent',
        sessionID: null,
        name: 'reviewer',
        role: 'reviewer',
        mode: 'background',
        state: 'queued',
        title: 'reviewer',
        openable: true,
      }],
    });
    expect(parsed?.[0]?.openable).toBe(false);
  });
});
