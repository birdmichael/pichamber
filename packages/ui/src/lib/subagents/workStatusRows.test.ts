import { describe, expect, test } from 'bun:test';

import {
  assignTranscriptSessionIds,
  buildWorkStatusSubagentRows,
  collectTranscriptSubagentSessionIds,
  resolveWorkStatusSubagentOpen,
} from './workStatusRows';
import type { SubagentRun } from './subagentRuns';

const run = (overrides: Partial<SubagentRun> = {}): SubagentRun => ({
  runId: 'run_1',
  parentID: 'ses_parent',
  sessionID: null,
  name: 'subagent',
  role: 'subagent',
  mode: 'foreground',
  state: 'done',
  title: 'List the README filename',
  openable: false,
  ...overrides,
});

describe('resolveWorkStatusSubagentOpen', () => {
  test('requires a session id and a directory, using the effective directory as fallback', () => {
    expect(resolveWorkStatusSubagentOpen({
      sessionID: 'child-1',
      directory: null,
      effectiveDirectory: '/repo',
    })).toEqual({ sessionID: 'child-1', directory: '/repo', openable: true });
    expect(resolveWorkStatusSubagentOpen({
      sessionID: null,
      directory: '/repo',
    })).toEqual({ sessionID: null, directory: '/repo', openable: false });
  });
});

describe('collectTranscriptSubagentSessionIds', () => {
  test('reads the same metadata and output fields as the transcript card', () => {
    expect(collectTranscriptSubagentSessionIds([{
      parts: [{
        tool: 'subagent',
        callID: 'call_1',
        state: {
          metadata: { sessionID: 'child-from-meta' },
          input: { agent: 'scout' },
        },
      }],
    }])).toEqual([{ runId: 'call_1', sessionID: 'child-from-meta' }]);
  });
});

describe('assignTranscriptSessionIds', () => {
  test('fills a status-only adapter row from the matching transcript tool part', () => {
    const assigned = assignTranscriptSessionIds(
      [run({ runId: 'call_1' })],
      [{ runId: 'call_1', sessionID: 'child-1' }],
    );
    expect(assigned[0]?.sessionID).toBe('child-1');
    expect(assigned[0]?.openable).toBe(true);
  });

  test('assigns an unmatched transcript child onto a status-only row in order', () => {
    const assigned = assignTranscriptSessionIds(
      [run({ runId: 'run_file' })],
      [{ runId: 'call_other', sessionID: 'child-1' }],
    );
    expect(assigned[0]?.sessionID).toBe('child-1');
  });
});

describe('buildWorkStatusSubagentRows', () => {
  test('makes the row a button when the transcript card has an openable child', () => {
    const rows = buildWorkStatusSubagentRows({
      runs: [run({ openable: false, sessionID: null })],
      transcriptIds: [{ runId: 'run_1', sessionID: 'child-1' }],
      directory: '/repo',
      untitledLabel: 'Subagent',
    });
    expect(rows).toEqual([{
      id: 'run_1',
      label: 'List the README filename',
      sessionID: 'child-1',
      openable: true,
      mode: 'foreground',
      status: 'done',
    }]);
  });

  test('keeps a row as status-only when no session id exists', () => {
    const rows = buildWorkStatusSubagentRows({
      runs: [run()],
      transcriptIds: [],
      directory: '/repo',
      untitledLabel: 'Subagent',
    });
    expect(rows[0]?.openable).toBe(false);
    expect(rows[0]?.sessionID).toBeNull();
  });
});
