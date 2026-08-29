import { describe, expect, test } from 'bun:test';

import {
  assignTranscriptSessionIds,
  buildWorkStatusSubagentRows,
  collectTranscriptSubagentSessionIds,
  overlayWorkStatusChildBlockers,
  overlayWorkStatusSubagentRow,
  resolveWorkStatusSubagentLabel,
  resolveWorkStatusSubagentOpen,
  countExportableWorkStatusRows,
  summarizeWorkStatusSubagentRows,
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
    expect(rows[0]?.status).toBe('queued');
  });

  test('does not map queued to working or stopped to failed', () => {
    const queued = buildWorkStatusSubagentRows({
      runs: [run({ state: 'queued' })],
      transcriptIds: [],
      directory: '/repo',
      untitledLabel: 'Subagent',
    });
    const stopped = buildWorkStatusSubagentRows({
      runs: [run({ state: 'stopped', sessionID: 'child-1', openable: true })],
      transcriptIds: [],
      directory: '/repo',
      untitledLabel: 'Subagent',
    });
    expect(queued[0]?.status).toBe('queued');
    expect(stopped[0]?.status).toBe('stopped');
  });

  test('maps an adapter interview blocker onto the question row', () => {
    const [row] = buildWorkStatusSubagentRows({
      runs: [run({
        state: 'running',
        sessionID: 'child-1',
        openable: true,
        blocker: 'question',
      })],
      transcriptIds: [],
      directory: '/repo',
      untitledLabel: 'Subagent',
    });
    expect(row?.status).toBe('question');
  });

  test('overlays child permission and question onto a Pi run row', () => {
    const [row] = buildWorkStatusSubagentRows({
      runs: [run({ state: 'running', sessionID: 'child-1', openable: true })],
      transcriptIds: [],
      directory: '/repo',
      untitledLabel: 'Subagent',
    });
    expect(overlayWorkStatusSubagentRow(row, { permission: true }).status).toBe('permission');
    expect(overlayWorkStatusSubagentRow(row, { question: true }).status).toBe('question');
    expect(overlayWorkStatusSubagentRow(row, { uiPrompt: true }).status).toBe('question');
    expect(overlayWorkStatusSubagentRow(row, {}).status).toBe('working');
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

describe('resolveWorkStatusSubagentLabel', () => {
  test('prefers session.title over a run-folder basename', () => {
    expect(resolveWorkStatusSubagentLabel(
      { title: 'scout', name: 'scout' },
      'scout-wt',
      'Subagent',
    )).toBe('scout-wt');
    expect(resolveWorkStatusSubagentLabel(
      { title: 'scout_b', name: 'scout' },
      'scout-b',
      'Subagent',
    )).toBe('scout-b');
    expect(resolveWorkStatusSubagentLabel(
      { title: 'long-scout', name: 'scout' },
      null,
      'Subagent',
    )).toBe('long-scout');
  });
});

describe('exportable work status rows', () => {
  test('does not count an unopenable queued adapter row as exportable', () => {
    const rows = buildWorkStatusSubagentRows({
      runs: [
        run({ runId: 'child-1', sessionID: 'ses_1', openable: true, state: 'done', title: 'scout-wt' }),
        run({ runId: 'child-2', sessionID: 'ses_2', openable: true, state: 'done', title: 'scout-b' }),
        run({ runId: 'child-3', sessionID: 'ses_3', openable: true, state: 'done', title: 'long-scout' }),
        run({ runId: 'ghost', sessionID: null, openable: false, state: 'queued', title: 'scout' }),
      ],
      transcriptIds: [],
      directory: '/repo',
      untitledLabel: 'Subagent',
    });
    expect(rows).toHaveLength(4);
    expect(countExportableWorkStatusRows(rows)).toBe(3);
    const summary = summarizeWorkStatusSubagentRows(rows);
    expect(summary.queuedUnopenable).toBe(1);
    expect(summary.openable).toBe(3);
    expect(summary.total).toBe(4);
  });
});
