import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  extractRunsFromFacadeMessages,
  extractRunsFromPiEntries,
  extractSubagentRunFromToolPart,
  isSubagentManagementCall,
  isSubagentsSlotActive,
  listAdapterRunsFromFiles,
  listNestedSessionRuns,
  mapStatusToSubagentRun,
  mapStatusToSubagentRuns,
  mergeSubagentRuns,
  normalizeSubagentRunMode,
  normalizeSubagentRunState,
  parentSessionMatches,
  listGitWorktreePaths,
  readSessionCwdFromSessionFile,
  readSessionFileFromText,
  readSessionIdFromSessionFile,
  readWorkflowScriptHints,
  reconcileParentSubagentRuns,
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
    expect(normalizeSubagentRunState('queued')).toBe('queued');
    expect(normalizeSubagentRunState('running')).toBe('running');
    expect(normalizeSubagentRunState('complete')).toBe('done');
    expect(normalizeSubagentRunState('paused')).toBe('paused');
    expect(normalizeSubagentRunState('failed')).toBe('failed');
    expect(normalizeSubagentRunMode('async')).toBe('background');
    expect(normalizeSubagentRunMode('sync')).toBe('foreground');
    expect(normalizeSubagentRunMode('management')).toBeNull();
    expect(normalizeSubagentRunMode('management', 'foreground')).toBeNull();
  });
});

describe('isSubagentManagementCall', () => {
  it('treats catalog and action-only calls as management', () => {
    expect(isSubagentManagementCall({ input: { action: 'list' } })).toBe(true);
    expect(isSubagentManagementCall({
      input: { action: 'list' },
      details: { mode: 'management', results: [] },
    })).toBe(true);
    expect(isSubagentManagementCall({ details: { mode: 'management', results: [] } })).toBe(true);
    expect(isSubagentManagementCall({ input: { action: 'status' } })).toBe(true);
    expect(isSubagentManagementCall({ input: { action: 'get', agent: 'scout' } })).toBe(true);
    expect(isSubagentManagementCall({ input: { action: 'models' } })).toBe(true);
    expect(isSubagentManagementCall({ input: { action: 'guide', topic: 'workflows' } })).toBe(true);
    expect(isSubagentManagementCall({ input: { action: 'children.list' } })).toBe(true);
    expect(isSubagentManagementCall({ input: { action: 'debug.run', id: 'run_1' } })).toBe(true);
    expect(isSubagentManagementCall({
      details: {
        mode: 'single',
        results: [],
        lifecycleStatus: { processTerminal: { state: 'pending' } },
      },
      output: 'Debug run\nSession: /tmp/other.jsonl',
    })).toBe(true);
    expect(isSubagentManagementCall({
      details: { mode: 'single', results: [], lifecycleStatus: {} },
      output: 'Status target: run 41584961-a3ae-4c57-9163-84b1a0b8a65a',
    })).toBe(true);
  });

  it('keeps a real scout/worker launch as a fleet run', () => {
    expect(isSubagentManagementCall({
      input: { agent: 'scout', task: 'Inspect the repo' },
    })).toBe(false);
    expect(isSubagentManagementCall({
      input: { action: 'run', agent: 'reviewer', task: 'Review the diff' },
    })).toBe(false);
  });
});

describe('readSessionFileFromText', () => {
  it('extracts a labeled or absolute jsonl session path', () => {
    expect(readSessionFileFromText('sessionFile: /tmp/pi-child/session.jsonl')).toBe('/tmp/pi-child/session.jsonl');
    expect(readSessionFileFromText('Wrote /Users/me/.pi/agent/sessions/child.jsonl for follow-up')).toBe(
      '/Users/me/.pi/agent/sessions/child.jsonl',
    );
    expect(readSessionFileFromText(`/${'a/'.repeat(40)}${'a'.repeat(80)} /tmp/pi-child/session.jsonl`)).toBe(
      '/tmp/pi-child/session.jsonl',
    );
  });

  it('finishes instantly on slash-heavy tool output without a jsonl path', () => {
    const catastrophic = `/${'a/'.repeat(40)}${'a'.repeat(200)}`;
    const oversized = `/${'a/'.repeat(200)}${'a'.repeat(4000)}`;
    const started = performance.now();
    expect(readSessionFileFromText(catastrophic)).toBe('');
    expect(readSessionFileFromText(oversized)).toBe('');
    expect(extractRunsFromPiEntries([{
      type: 'message',
      message: {
        role: 'toolResult',
        toolName: 'subagent',
        toolCallId: 'call_redos',
        content: catastrophic,
        isError: false,
      },
    }], 'parent-1')[0]).toMatchObject({
      runId: 'call_redos',
      sessionFile: null,
    });
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe('session file and parent matching', () => {
  it('reads the Pi session id from a jsonl header', () => {
    const dir = makeTemp();
    const file = path.join(dir, 'child.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ type: 'session', id: 'child-uuid', cwd: '/repo-worktree' })}\n`);
    expect(readSessionIdFromSessionFile(file)).toBe('child-uuid');
    expect(readSessionCwdFromSessionFile(file)).toBe('/repo-worktree');
  });

  it('matches parent by id, session file, or basename', () => {
    const parent = { id: 'parent-1', sessionFile: '/tmp/parent.jsonl' };
    expect(parentSessionMatches('parent-1', parent)).toBe(true);
    expect(parentSessionMatches('/tmp/parent.jsonl', parent)).toBe(true);
    expect(parentSessionMatches('other', parent)).toBe(false);
  });

  it('matches an Untitled jsonl path when parent.id is only the Pi header id', () => {
    const parent = { id: '01a03f89-7d6b-734b-9e31-78b07afd96a7' };
    expect(parentSessionMatches(
      '/Users/me/.pi/agent/sessions/chat/2026-08-26T19-26-10-283Z_01a03f89-7d6b-734b-9e31-78b07afd96a7.jsonl',
      parent,
    )).toBe(true);
    expect(parentSessionMatches(
      '/Users/me/.pi/agent/sessions/chat/2026-08-26T19-26-10-283Z_01a03f89-7d6b-734b-9e31-78b07afd96a7.jsonl',
      { id: 'someone-else' },
    )).toBe(false);
  });
});

describe('readWorkflowScriptHints', () => {
  it('reads the run label and agent from an async workflow script', () => {
    expect(readWorkflowScriptHints(`return runs.run("disk-scan", {
  agent: "worker",
  task: \`只读检查磁盘\`,
})`)).toEqual({
      agent: 'worker',
      label: 'disk-scan',
      task: '',
    });
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
    expect(toPublicSubagentRun(runs[0])).toMatchObject({
      openable: true,
      sessionID: 'scout-session',
      directory: null,
    });
    expect(toPublicSubagentRun({
      ...runs[0],
      toolCallId: 'call-disk',
    }).toolCallId).toBe('call-disk');
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
    expect(run.state).toBe('queued');
    expect(toPublicSubagentRun(run).openable).toBe(false);
  });

  it('emits one row per child session file in a fan-out workflow', () => {
    const tmpdir = makeTemp('pi-subagents-tmp-');
    const runDir = path.join(tmpdir, 'pi-subagents-user', 'async-subagent-runs', 'run_fanout');
    fs.mkdirSync(runDir, { recursive: true });
    const childA = path.join(runDir, 'a.jsonl');
    const childB = path.join(runDir, 'b.jsonl');
    fs.writeFileSync(childA, `${JSON.stringify({ type: 'session', id: 'child-a' })}\n`);
    fs.writeFileSync(childB, `${JSON.stringify({ type: 'session', id: 'child-b' })}\n`);
    fs.writeFileSync(path.join(runDir, 'status.json'), JSON.stringify({
      runId: 'run_fanout',
      toolCallId: 'call-shared',
      sessionId: 'parent-1',
      state: 'complete',
      mode: 'workflow',
      currentTool: 'contact_supervisor',
      currentToolArgs: 'reason=interview_request',
      steps: [
        {
          agent: 'scout',
          label: 'scout-a',
          status: 'running',
          sessionFile: childA,
          currentTool: 'contact_supervisor',
          currentToolArgs: 'reason=interview_request',
        },
        {
          agent: 'scout',
          label: 'scout-b',
          status: 'completed',
          sessionFile: childB,
        },
      ],
    }));
    const runs = listAdapterRunsFromFiles({
      parent: { id: 'parent-1' },
      tmpdir,
    });
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.sessionID).sort()).toEqual(['child-a', 'child-b']);
    expect(runs.find((run) => run.sessionID === 'child-a')).toMatchObject({
      title: 'scout-a',
      state: 'running',
      blocker: 'question',
    });
    expect(runs.find((run) => run.sessionID === 'child-b')).toMatchObject({
      title: 'scout-b',
      state: 'done',
    });
    expect(runs.find((run) => run.sessionID === 'child-b').blocker).toBeUndefined();
  });
});

describe('child-session directory plumbing', () => {
  it('exposes jsonl cwd on the public subagent run', () => {
    const dir = makeTemp();
    const file = path.join(dir, 'child.jsonl');
    fs.writeFileSync(file, `${JSON.stringify({ type: 'session', id: 'child-wt', cwd: '/repo-worktree' })}\n`);
    const publicRun = toPublicSubagentRun({
      runId: 'run_wt',
      parentID: 'parent-1',
      sessionID: 'child-wt',
      directory: readSessionCwdFromSessionFile(file),
      name: 'scout',
      role: 'scout',
      mode: 'background',
      state: 'running',
      title: 'Inspect the worktree',
    });
    expect(publicRun).toMatchObject({
      sessionID: 'child-wt',
      directory: '/repo-worktree',
      openable: true,
    });
  });

  it('finds a worktree-cwd child when parent is at the repo root', () => {
    const root = makeTemp('pi-subagent-repo-');
    execFileSync('git', ['init', '-b', 'main', root], { stdio: 'ignore' });
    execFileSync('git', ['-C', root, 'config', 'user.email', 't@t.example'], { stdio: 'ignore' });
    execFileSync('git', ['-C', root, 'config', 'user.name', 't'], { stdio: 'ignore' });
    execFileSync('git', ['-C', root, 'commit', '--allow-empty', '-m', 'init'], { stdio: 'ignore' });
    const worktree = path.join(path.dirname(root), `${path.basename(root)}-wt`);
    execFileSync('git', ['-C', root, 'worktree', 'add', worktree, '-b', 'child'], { stdio: 'ignore' });
    tempDirs.push(worktree);

    expect(listGitWorktreePaths(root)).toEqual(expect.arrayContaining([root, worktree]));

    const runDir = path.join(worktree, '.pi', 'subagents', 'async-subagent-runs', 'run_wt');
    fs.mkdirSync(runDir, { recursive: true });
    const childFile = path.join(runDir, 'child.jsonl');
    fs.writeFileSync(childFile, `${JSON.stringify({ type: 'session', id: 'child-wt', cwd: worktree })}\n`);
    fs.writeFileSync(path.join(runDir, 'status.json'), JSON.stringify({
      runId: 'run_wt',
      sessionId: 'parent-1',
      state: 'running',
      mode: 'async',
      sessionFile: childFile,
      steps: [{ agent: 'scout', status: 'running', sessionFile: childFile }],
    }));

    const isolatedTmp = makeTemp('pi-subagent-empty-tmp-');
    const runs = listAdapterRunsFromFiles({
      parent: { id: 'parent-1' },
      projectDir: root,
      tmpdir: isolatedTmp,
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      runId: 'run_wt',
      sessionID: 'child-wt',
      directory: worktree,
    });
    expect(toPublicSubagentRun(runs[0])).toMatchObject({
      directory: worktree,
      openable: true,
    });
  });

  it('reads cwd from a nested run-0/session.jsonl under the parent session dir', () => {
    const sessionDir = makeTemp('pi-nested-sessions-');
    const parentID = '01a04ce8-3480-7001-8001-pichamber34801';
    const childId = '01a04ce8-3480-7001-8002-pichamber34802';
    const childDir = '/tmp/pichamber-348-fixture/child-wt';
    const childFile = path.join(sessionDir, parentID, 'run_scout', 'run-0', 'session.jsonl');
    fs.mkdirSync(path.dirname(childFile), { recursive: true });
    fs.writeFileSync(childFile, `${JSON.stringify({
      type: 'session',
      id: childId,
      cwd: childDir,
    })}\n`);
    const runs = listNestedSessionRuns({
      parent: { id: parentID },
      sessionDir,
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      runId: 'run_scout',
      sessionID: childId,
      sessionFile: childFile,
      directory: childDir,
    });
    expect(toPublicSubagentRun(runs[0])).toMatchObject({
      sessionID: childId,
      directory: childDir,
      openable: true,
    });
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

  it('does not treat the parent session id as an openable child', () => {
    const run = extractSubagentRunFromToolPart({
      tool: 'subagent',
      callID: 'call_parent',
      state: {
        status: 'completed',
        input: { agent: 'subagent', sessionId: 'parent-1' },
        metadata: { sessionID: 'parent-1' },
      },
    }, 'parent-1');
    expect(run.sessionID).toBeNull();
    expect(toPublicSubagentRun(run).openable).toBe(false);
    expect(toPublicSubagentRun({
      ...run,
      sessionID: 'parent-1',
      parentID: 'parent-1',
    }).sessionID).toBeNull();
  });

  it('reads sessionId and childSessionId from tool input/output like the transcript card', () => {
    expect(extractSubagentRunFromToolPart({
      tool: 'subagent',
      callID: 'call_input',
      state: {
        status: 'error',
        input: { agent: 'scout', sessionId: 'child-from-input' },
        output: 'NotImplementedError: node:v8 createHook is not yet implemented in Bun',
      },
    }, 'parent-1')).toMatchObject({
      runId: 'call_input',
      sessionID: 'child-from-input',
    });
    expect(extractSubagentRunFromToolPart({
      tool: 'subagent',
      callID: 'call_child',
      state: {
        status: 'error',
        input: { agent: 'scout', childSessionId: 'child-from-field' },
        output: 'failed',
      },
    }, 'parent-1')).toMatchObject({
      runId: 'call_child',
      sessionID: 'child-from-field',
    });
  });

  it('collapses an async workflow toolCall and toolResult that use different ids', () => {
    const runs = extractRunsFromPiEntries([{
      type: 'message',
      message: {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: 'call-22a00b99-4358-4bde-a794-9074f07932fd-21|fc_ae8d6f68',
          name: 'subagent',
          arguments: {
            async: true,
            workflowScript: 'return runs.run("disk-scan", { agent: "worker", task: `只读检查磁盘` })',
          },
        }],
      },
    }, {
      type: 'message',
      message: {
        role: 'toolResult',
        toolName: 'subagent',
        toolCallId: 'call-22a00b99-4358-4bde-a794-9074f07932fd-21|fc_ae8d6f68',
        content: 'Async workflow [c10cff12-5d1f-44dd-b1a1-b4f4a0d26541]',
        details: { mode: 'workflow', runId: 'c10cff12-5d1f-44dd-b1a1-b4f4a0d26541' },
        isError: false,
      },
    }], 'parent-1');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      runId: 'c10cff12-5d1f-44dd-b1a1-b4f4a0d26541',
      toolCallId: 'call-22a00b99-4358-4bde-a794-9074f07932fd-21|fc_ae8d6f68',
      name: 'worker',
      title: 'disk-scan',
      mode: 'background',
    });
  });

  it('reads a child session id from an assistant toolCall argument block', () => {
    const runs = extractRunsFromPiEntries([{
      type: 'message',
      message: {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: 'call_args',
          name: 'subagent',
          arguments: { agent: 'scout', sessionId: 'child-from-call', task: 'List the README filename' },
        }],
      },
    }, {
      type: 'message',
      message: {
        role: 'toolResult',
        toolName: 'subagent',
        toolCallId: 'call_args',
        content: [{ type: 'text', text: 'NotImplementedError: createHook' }],
        isError: true,
      },
    }], 'parent-1');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      runId: 'call_args',
      sessionID: 'child-from-call',
      state: 'failed',
    });
  });

  it('reads a child session file from Pi toolResult text', () => {
    const dir = makeTemp();
    const childFile = path.join(dir, 'child.jsonl');
    fs.writeFileSync(childFile, `${JSON.stringify({ type: 'session', id: 'pi-child-text' })}\n`);
    const runs = extractRunsFromPiEntries([{
      type: 'message',
      id: 'tool_text',
      message: {
        role: 'toolResult',
        toolName: 'subagent',
        toolCallId: 'call_text',
        content: `Session written to ${childFile}`,
        isError: false,
      },
    }], 'parent-1');
    expect(runs[0]).toMatchObject({
      runId: 'call_text',
      sessionID: 'pi-child-text',
      sessionFile: childFile,
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

  it('does not treat a management list call as a fleet run', () => {
    expect(extractSubagentRunFromToolPart({
      tool: 'subagent',
      callID: 'call_list',
      state: {
        status: 'completed',
        input: { action: 'list' },
        output: JSON.stringify({ details: { mode: 'management', results: [] } }),
      },
    }, 'parent-1')).toBeNull();
    expect(extractRunsFromPiEntries([{
      type: 'message',
      message: {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: 'call_list',
          name: 'subagent',
          arguments: { action: 'list' },
        }],
      },
    }, {
      type: 'message',
      message: {
        role: 'toolResult',
        toolName: 'subagent',
        toolCallId: 'call_list',
        content: 'Executable agents: scout, worker, reviewer',
        details: { mode: 'management', results: [] },
        isError: false,
      },
    }], 'parent-1')).toEqual([]);
    expect(extractRunsFromFacadeMessages([{
      parts: [{
        tool: 'subagent',
        callID: 'call_list',
        state: {
          status: 'completed',
          input: { action: 'list' },
          output: JSON.stringify({ mode: 'management', results: [] }),
        },
      }],
    }], 'parent-1')).toEqual([]);
  });

  it('does not treat a debug.run dump that names another chat as a fleet child', () => {
    const dir = makeTemp();
    const otherFile = path.join(dir, '2026-08-28T11-52-33-467Z_01a04836-e9bb-7f89-b60b-5b9346813f73.jsonl');
    fs.writeFileSync(otherFile, `${JSON.stringify({ type: 'session', id: '01a04836-e9bb-7f89-b60b-5b9346813f73' })}\n`);
    expect(extractRunsFromPiEntries([{
      type: 'message',
      message: {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: 'call-debug|fc_1',
          name: 'subagent',
          arguments: { action: 'debug.run', id: '41584961-a3ae-4c57-9163-84b1a0b8a65a' },
        }],
      },
    }, {
      type: 'message',
      message: {
        role: 'toolResult',
        toolName: 'subagent',
        toolCallId: 'call-debug|fc_1_1',
        content: `Debug run\nSession: ${otherFile}`,
        details: {
          mode: 'single',
          results: [],
          lifecycleStatus: { processTerminal: { state: 'pending' } },
        },
        isError: false,
      },
    }], '01a03dfa-077b-7710-aad7-6844ac3e0259')).toEqual([]);
  });
});

describe('reconcileParentSubagentRuns', () => {
  it('prefers the live tool-call session id and drops terminal ghost files', () => {
    const reconciled = reconcileParentSubagentRuns(
      Array.from({ length: 10 }, (_, index) => ({
        runId: `ghost_${index}`,
        name: 'subagent',
        title: 'subagent',
        mode: index === 9 ? 'background' : 'foreground',
        state: index === 9 ? 'failed' : 'done',
        sessionID: null,
      })),
      [{
        runId: 'call_live',
        name: 'scout',
        title: 'List the README filename',
        mode: 'foreground',
        state: 'failed',
        sessionID: 'child-live',
        toolCallId: 'call_live',
      }],
    );
    expect(reconciled).toEqual([expect.objectContaining({
      runId: 'call_live',
      sessionID: 'child-live',
    })]);
    expect(toPublicSubagentRun(reconciled[0]).openable).toBe(true);
  });

  it('joins a live workflow toolCall to the adapter child and copies terminal state', () => {
    const dir = makeTemp();
    const childFile = path.join(dir, 'session.jsonl');
    fs.writeFileSync(childFile, `${JSON.stringify({ type: 'session', id: '01a03f8b-child' })}\n`);
    const reconciled = reconcileParentSubagentRuns([{
      runId: 'c10cff12-5d1f-44dd-b1a1-b4f4a0d26541',
      toolCallId: 'call-22a00b99',
      name: 'worker',
      title: 'disk-scan',
      mode: 'background',
      state: 'failed',
      sessionID: '01a03f8b-child',
      sessionFile: childFile,
    }], [{
      runId: 'call-22a00b99',
      toolCallId: 'call-22a00b99',
      name: 'subagent',
      title: 'subagent',
      mode: 'background',
      state: 'running',
      sessionID: null,
    }]);
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({
      name: 'worker',
      title: 'disk-scan',
      state: 'failed',
      sessionID: '01a03f8b-child',
    });
    expect(toPublicSubagentRun(reconciled[0]).openable).toBe(true);
  });

  it('keeps adapter running when the parent tool already completed', () => {
    const reconciled = reconcileParentSubagentRuns([{
      runId: 'run_live',
      toolCallId: 'call-shared',
      name: 'scout',
      title: 'scout-a',
      mode: 'background',
      state: 'running',
      sessionID: 'child-a',
      blocker: 'question',
    }], [{
      runId: 'call-shared',
      toolCallId: 'call-shared',
      name: 'subagent',
      title: 'subagent',
      mode: 'background',
      state: 'done',
      sessionID: null,
    }]);
    expect(reconciled).toEqual([expect.objectContaining({
      sessionID: 'child-a',
      state: 'running',
      blocker: 'question',
    })]);
  });

  it('keeps two fan-out children instead of collapsing them onto one tool call', () => {
    const reconciled = reconcileParentSubagentRuns([
      {
        runId: 'run_fanout:child-a',
        toolCallId: 'call-shared',
        name: 'scout',
        title: 'scout-a',
        mode: 'background',
        state: 'running',
        sessionID: 'child-a',
      },
      {
        runId: 'run_fanout:child-b',
        toolCallId: 'call-shared',
        name: 'scout',
        title: 'scout-b',
        mode: 'background',
        state: 'done',
        sessionID: 'child-b',
      },
    ], [{
      runId: 'call-shared',
      toolCallId: 'call-shared',
      name: 'subagent',
      title: 'subagent',
      mode: 'background',
      state: 'done',
      sessionID: null,
    }]);
    expect(reconciled).toHaveLength(2);
    expect(reconciled.map((run) => run.sessionID).sort()).toEqual(['child-a', 'child-b']);
  });

  it('keeps a queued file run without an id as status-only', () => {
    const reconciled = reconcileParentSubagentRuns([{
      runId: 'run_early',
      name: 'reviewer',
      title: 'reviewer',
      mode: 'background',
      state: 'queued',
      sessionID: null,
    }], []);
    expect(reconciled).toHaveLength(1);
    expect(toPublicSubagentRun(reconciled[0]).openable).toBe(false);
  });

  it('drops finished tool-calls without a child instead of keeping one to mint', () => {
    const reconciled = reconcileParentSubagentRuns([], [
      {
        runId: 'old_done',
        toolCallId: 'old_done',
        name: 'subagent',
        state: 'done',
        sessionID: null,
        startedAt: 1,
      },
      {
        runId: 'newer_failed',
        toolCallId: 'newer_failed',
        name: 'scout',
        state: 'failed',
        sessionID: null,
        startedAt: 2,
      },
      {
        runId: 'still_running',
        toolCallId: 'still_running',
        name: 'scout',
        state: 'running',
        sessionID: null,
        startedAt: 3,
      },
      {
        runId: 'has_child',
        name: 'scout',
        state: 'done',
        sessionID: 'child-1',
        parentID: 'parent-1',
        startedAt: 0,
      },
    ]);
    expect(reconciled.map((run) => run.runId).sort()).toEqual([
      'has_child',
      'still_running',
    ]);
    expect(toPublicSubagentRun(reconciled.find((run) => run.runId === 'still_running')).openable).toBe(false);
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

  it('returns null for a management catalog status', () => {
    expect(mapStatusToSubagentRun({
      runId: 'call_list',
      mode: 'management',
      state: 'complete',
      results: [],
    })).toBeNull();
  });

  it('prefers a live step over a completed workflow state', () => {
    expect(mapStatusToSubagentRun({
      runId: 'run_1',
      state: 'complete',
      mode: 'workflow',
      steps: [{ agent: 'scout', status: 'running' }],
    })).toMatchObject({ state: 'running' });
  });

  it('expands multiple session files into separate runs', () => {
    const mapped = mapStatusToSubagentRuns({
      runId: 'run_1',
      toolCallId: 'call-1',
      state: 'complete',
      mode: 'workflow',
      steps: [
        { agent: 'scout', label: 'a', status: 'running', sessionFile: '/tmp/a.jsonl' },
        { agent: 'scout', label: 'b', status: 'completed', sessionFile: '/tmp/b.jsonl' },
      ],
    });
    expect(mapped).toHaveLength(2);
    expect(mapped.map((run) => run.title)).toEqual(['a', 'b']);
  });
});
