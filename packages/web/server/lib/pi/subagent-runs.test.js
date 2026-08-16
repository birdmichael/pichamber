import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  extractRunsFromFacadeMessages,
  extractRunsFromPiEntries,
  extractSubagentRunFromToolPart,
  isSubagentsSlotActive,
  listAdapterRunsFromFiles,
  mapStatusToSubagentRun,
  mergeSubagentRuns,
  normalizeSubagentRunMode,
  normalizeSubagentRunState,
  parentSessionMatches,
  readSessionIdFromSessionFile,
  toPublicSubagentRun,
} from './subagent-runs.js';

const tempDirs = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const makeTemp = (prefix = 'pi-subagent-runs-') => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

describe('isSubagentsSlotActive', () => {
  it('requires installed and enabled', () => {
    expect(isSubagentsSlotActive({ slots: { subagents: { installed: true, enabled: true } } })).toBe(true);
    expect(isSubagentsSlotActive({ slots: { subagents: { installed: true, enabled: false } } })).toBe(false);
    expect(isSubagentsSlotActive({ slots: { subagents: { installed: false, enabled: true } } })).toBe(false);
    expect(isSubagentsSlotActive({})).toBe(false);
  });
});

describe('normalize helpers', () => {
  it('maps adapter states onto the Work Status contract', () => {
    expect(normalizeSubagentRunState('running')).toBe('running');
    expect(normalizeSubagentRunState('complete')).toBe('done');
    expect(normalizeSubagentRunState('paused')).toBe('paused');
    expect(normalizeSubagentRunState('failed')).toBe('failed');
    expect(normalizeSubagentRunMode('async')).toBe('background');
    expect(normalizeSubagentRunMode('sync')).toBe('foreground');
  });
});

describe('session file and parent matching', () => {
  it('reads the Pi session id from a jsonl header', () => {
    const dir = makeTemp();
    const file = path.join(dir, 'child.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ type: 'session', id: 'child-uuid' })}\n`);
    expect(readSessionIdFromSessionFile(file)).toBe('child-uuid');
  });

  it('matches parent by id, session file, or basename', () => {
    const parent = { id: 'parent-1', sessionFile: '/tmp/parent.jsonl' };
    expect(parentSessionMatches('parent-1', parent)).toBe(true);
    expect(parentSessionMatches('/tmp/parent.jsonl', parent)).toBe(true);
    expect(parentSessionMatches('other', parent)).toBe(false);
  });
});

describe('listAdapterRunsFromFiles', () => {
  it('returns only runs owned by the parent session', () => {
    const tmpdir = makeTemp('pi-subagents-tmp-');
    const scope = path.join(tmpdir, 'pi-subagents-user');
    const runDir = path.join(scope, 'async-subagent-runs', 'run_scout');
    fs.mkdirSync(runDir, { recursive: true });
    const childFile = path.join(runDir, 'child.jsonl');
    fs.writeFileSync(childFile, `${JSON.stringify({ type: 'session', id: 'scout-session' })}\n`);
    fs.writeFileSync(path.join(runDir, 'status.json'), JSON.stringify({
      runId: 'run_scout',
      sessionId: 'parent-1',
      state: 'running',
      mode: 'async',
      sessionFile: childFile,
      steps: [{ agent: 'scout', status: 'running', sessionFile: childFile }],
    }));
    const otherDir = path.join(scope, 'async-subagent-runs', 'run_other');
    fs.mkdirSync(otherDir, { recursive: true });
    fs.writeFileSync(path.join(otherDir, 'status.json'), JSON.stringify({
      runId: 'run_other',
      sessionId: 'someone-else',
      state: 'running',
      mode: 'async',
      steps: [{ agent: 'reviewer', status: 'running' }],
    }));

    const runs = listAdapterRunsFromFiles({
      parent: { id: 'parent-1' },
      tmpdir,
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      runId: 'run_scout',
      name: 'scout',
      mode: 'background',
      state: 'running',
      sessionID: 'scout-session',
    });
    expect(toPublicSubagentRun(runs[0]).openable).toBe(true);
  });

  it('keeps a run without a child session id as status-only', () => {
    const tmpdir = makeTemp('pi-subagents-tmp-');
    const runDir = path.join(tmpdir, 'pi-subagents-user', 'async-subagent-runs', 'run_early');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'status.json'), JSON.stringify({
      runId: 'run_early',
      sessionId: 'parent-1',
      state: 'queued',
      mode: 'async',
      steps: [{ agent: 'reviewer', status: 'queued' }],
    }));
    const [run] = listAdapterRunsFromFiles({
      parent: { id: 'parent-1' },
      tmpdir,
    });
    expect(run.sessionID).toBeNull();
    expect(toPublicSubagentRun(run).openable).toBe(false);
  });
});

describe('tool-part extraction', () => {
  it('reads a foreground subagent tool call from the parent transcript', () => {
    const run = extractSubagentRunFromToolPart({
      tool: 'subagent',
      callID: 'call_1',
      state: {
        status: 'running',
        input: { agent: 'scout', task: 'Inspect the repo', async: false },
      },
    }, 'parent-1');
    expect(run).toMatchObject({
      runId: 'call_1',
      name: 'scout',
      mode: 'foreground',
      state: 'running',
      parentID: 'parent-1',
    });
  });

  it('reads a child session id from tool metadata the transcript card uses', () => {
    const run = extractSubagentRunFromToolPart({
      tool: 'subagent',
      callID: 'call_meta',
      state: {
        status: 'completed',
        input: { agent: 'scout', task: 'List the README filename' },
        metadata: { sessionID: 'child-from-meta' },
      },
    }, 'parent-1');
    expect(run).toMatchObject({
      runId: 'call_meta',
      sessionID: 'child-from-meta',
    });
  });

  it('reads a child session file from Pi toolResult details', () => {
    const dir = makeTemp();
    const childFile = path.join(dir, 'child.jsonl');
    fs.writeFileSync(childFile, `${JSON.stringify({ type: 'session', id: 'pi-child' })}\n`);
    const runs = extractRunsFromPiEntries([{
      type: 'message',
      id: 'tool_1',
      message: {
        role: 'toolResult',
        toolName: 'subagent',
        toolCallId: 'call_pi',
        details: { sessionFile: childFile, agent: 'scout' },
        isError: false,
      },
    }], 'parent-1');
    expect(runs[0]).toMatchObject({
      runId: 'call_pi',
      sessionID: 'pi-child',
      sessionFile: childFile,
    });
  });

  it('prefers output details for a completed child session id', () => {
    const run = extractSubagentRunFromToolPart({
      tool: 'subagent',
      callID: 'call_2',
      state: {
        status: 'completed',
        input: { agent: 'reviewer' },
        output: JSON.stringify({
          details: { runId: 'run_review', sessionId: 'review-session', state: 'complete' },
        }),
      },
    }, 'parent-1');
    expect(run).toMatchObject({
      runId: 'run_review',
      sessionID: 'review-session',
      state: 'done',
    });
  });

  it('ignores leftover OpenCode Task parts', () => {
    expect(extractSubagentRunFromToolPart({
      tool: 'task',
      state: { input: { subagent_type: 'explore' } },
    }, 'parent-1')).toBeNull();
  });
});

describe('mergeSubagentRuns', () => {
  it('fills a file run with transcript agent details without duplicating', () => {
    const merged = mergeSubagentRuns(
      [{ runId: 'run_1', name: 'subagent', state: 'running', sessionID: 'child-1' }],
      extractRunsFromFacadeMessages([{
        parts: [{
          tool: 'subagent',
          callID: 'run_1',
          state: { status: 'running', input: { agent: 'scout', task: 'Look around' } },
        }],
      }], 'parent-1'),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      runId: 'run_1',
      name: 'scout',
      sessionID: 'child-1',
      title: 'Look around',
    });
  });
});

describe('mapStatusToSubagentRun', () => {
  it('returns null without a run id', () => {
    expect(mapStatusToSubagentRun({ state: 'running' })).toBeNull();
  });
});
