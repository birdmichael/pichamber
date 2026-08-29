import { describe, expect, test } from 'bun:test';

import {
  assignTranscriptSessionIds,
  buildWorkStatusSubagentRows,
  collectTranscriptSubagentSessionIds,
  overlayWorkStatusChildBlockers,
  resolveWorkStatusSubagentOpen,
} from './workStatusRows';
import type { SubagentRun } from './subagentRuns';

const run = (overrides: Partial<SubagentRun> = {}): SubagentRun => ({
  runId: 'run_1',
  parentID: 'ses_parent',
  sessionID: null,
  directory: null,
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
    expect(resolveWorkStatusSubagentOpen({
      sessionID: 'child-1',
      directory: '/repo-worktree',
      effectiveDirectory: '/repo',
    })).toEqual({ sessionID: 'child-1', directory: '/repo-worktree', openable: true });
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

  test('does not invent a child id from a management list call', () => {
    expect(collectTranscriptSubagentSessionIds([{
      parts: [{
        tool: 'subagent',
        callID: 'call_list',
        state: {
          input: { action: 'list' },
          output: JSON.stringify({ details: { mode: 'management', results: [] } }),
        },
      }],
    }])).toEqual([]);
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

  test('joins a workflow runId to the parent tool call id', () => {
    const assigned = assignTranscriptSessionIds(
      [run({ runId: 'c10cff12', toolCallId: 'call_1' })],
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
      directory: '/repo',
      openable: true,
      mode: 'foreground',
      status: 'done',
    }]);
  });

  test('keeps a live row as status-only when no session id exists yet', () => {
    const rows = buildWorkStatusSubagentRows({
      runs: [run({ state: 'queued' })],
      transcriptIds: [],
      directory: '/repo',
      untitledLabel: 'Subagent',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.openable).toBe(false);
    expect(rows[0]?.sessionID).toBeNull();
  });

  test('drops terminal ghost rows that have no child session id', () => {
    const rows = buildWorkStatusSubagentRows({
      runs: [
        run({ runId: 'ghost_1', state: 'done' }),
        run({ runId: 'ghost_2', state: 'failed', mode: 'background' }),
        run({ runId: 'call_1', sessionID: null, openable: false }),
      ],
      transcriptIds: [{ runId: 'call_1', sessionID: 'child-1' }],
      directory: '/repo',
      untitledLabel: 'Subagent',
    });
    expect(rows).toEqual([{
      id: 'call_1',
      label: 'List the README filename',
      sessionID: 'child-1',
      directory: '/repo',
      openable: true,
      mode: 'foreground',
      status: 'done',
    }]);
  });

  test('opens a worktree-cwd child with the child directory, not the parent', () => {
    const rows = buildWorkStatusSubagentRows({
      runs: [run({
        sessionID: 'child-wt',
        directory: '/repo-worktree',
        openable: true,
      })],
      transcriptIds: [],
      directory: '/repo',
      untitledLabel: 'Subagent',
    });
    expect(rows[0]?.directory).toBe('/repo-worktree');
    expect(rows[0]?.openable).toBe(true);
  });

  test('overlays a permission blocker from the child store without rewriting run state mapping', () => {
    const rows = overlayWorkStatusChildBlockers(
      [{
        id: 'run_1',
        label: 'scout',
        sessionID: 'child-wt',
        directory: '/repo-worktree',
        openable: true,
        mode: 'background',
        status: 'working',
      }],
      {
        permissions: { 'child-wt': [{ id: 'perm_1' }] },
        questions: {},
      },
    );
    expect(rows[0]?.status).toBe('permission');
  });
});
