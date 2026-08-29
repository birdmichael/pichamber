import { describe, expect, test } from 'bun:test';

import { subagentRunsRequestHeaders, visibleSubagentRuns } from './useSubagentRuns';
import type { SubagentRun } from '@/lib/subagents/subagentRuns';

const run = (parentID: string): SubagentRun => ({
  runId: 'run_1',
  parentID,
  sessionID: 'child-1',
  directory: null,
  name: 'scout',
  role: 'subagent',
  mode: 'foreground',
  state: 'running',
  title: 'Inspect',
  openable: true,
});

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

describe('visibleSubagentRuns', () => {
  test('hides a previous parent fleet until the current session is ready', () => {
    const previous = {
      sessionId: 'ses_a',
      status: 'ready' as const,
      runs: [run('ses_a')],
    };

    expect(visibleSubagentRuns(previous, 'ses_b', true)).toEqual({
      runs: [],
      status: 'loading',
    });
    expect(visibleSubagentRuns(previous, 'ses_a', true)).toEqual({
      runs: previous.runs,
      status: 'ready',
    });
    expect(visibleSubagentRuns(previous, 'ses_b', false)).toEqual({
      runs: [],
      status: 'idle',
    });
    expect(visibleSubagentRuns(previous, null, true)).toEqual({
      runs: [],
      status: 'idle',
    });
  });
});
