import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { writeFeaturePlugins } from './feature-plugins.js';
import { createInMemoryPiSession, createPiHost } from './pi-host.js';

const tempHomes = [];
afterEach(() => {
  for (const dir of tempHomes.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const makeHome = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-host-subagents-'));
  tempHomes.push(dir);
  return dir;
};

const enableSubagentsSlot = (home) => {
  fs.mkdirSync(path.join(home, '.pi', 'agent'), { recursive: true });
  fs.writeFileSync(path.join(home, '.pi', 'agent', 'settings.json'), `${JSON.stringify({
    packages: ['npm:pi-subagents'],
  }, null, 2)}\n`);
  writeFeaturePlugins(home, { subagents: { enabled: true, source: 'npm:pi-subagents' } });
};

describe('Pi host subagent runs', () => {
  it('hides leftover parentID children when the slot is off', async () => {
    const home = makeHome();
    const host = createPiHost({
      home,
      defaultDirectory: '/tmp/project',
      mock: true,
      createSession: async () => createInMemoryPiSession(),
    });
    const parent = await host.createSession({ directory: '/tmp/project', title: 'Parent' });
    await host.createSession({
      directory: '/tmp/project',
      title: 'Leftover clone',
      parentID: parent.id,
    });
    expect(await host.listSessionChildren(parent.id)).toEqual([]);
    expect(await host.listSubagentRuns(parent.id)).toEqual({ runs: [] });
  });

  it('does not spawn a reviewer when the slot is on and no adapter run exists', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const host = createPiHost({
      home,
      defaultDirectory: '/tmp/project',
      mock: true,
      createSession: async () => createInMemoryPiSession(),
    });
    const parent = await host.createSession({ directory: '/tmp/project', title: 'Parent' });
    expect(await host.listSubagentRuns(parent.id)).toEqual({ runs: [] });
    expect(await host.listSessionChildren(parent.id)).toEqual([]);
  });

  it('lists adapter children and attaches an openable child session', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const tmpdir = path.join(home, 'tmp');
    const runDir = path.join(tmpdir, 'pi-subagents-user', 'async-subagent-runs', 'run_scout');
    fs.mkdirSync(runDir, { recursive: true });
    const childFile = path.join(runDir, 'child.jsonl');
    fs.writeFileSync(childFile, `${JSON.stringify({
      type: 'session',
      id: 'scout-child',
      cwd: '/tmp/project',
    })}\n${JSON.stringify({
      type: 'message',
      id: 'msg_user',
      role: 'user',
      content: 'Inspect the repo',
      timestamp: new Date().toISOString(),
    })}\n`);

    const originalTmp = process.env.TMPDIR;
    process.env.TMPDIR = tmpdir;
    const host = createPiHost({
      home,
      defaultDirectory: '/tmp/project',
      mock: true,
      createSession: async ({ sessionManager } = {}) => createInMemoryPiSession({
        sessionId: sessionManager?.getSessionId?.() || 'mock',
      }),
    });
    const parent = await host.createSession({ directory: '/tmp/project', title: 'Parent' });
    fs.writeFileSync(path.join(runDir, 'status.json'), JSON.stringify({
      runId: 'run_scout',
      sessionId: parent.id,
      state: 'running',
      mode: 'async',
      sessionFile: childFile,
      steps: [{ agent: 'scout', status: 'running', sessionFile: childFile }],
    }));

    try {
      const listed = await host.listSubagentRuns(parent.id);
      expect(listed.runs).toEqual([expect.objectContaining({
        runId: 'run_scout',
        name: 'scout',
        mode: 'background',
        state: 'running',
        sessionID: 'scout-child',
        openable: true,
      })]);
      const child = await host.ensureSession('scout-child', '/tmp/project');
      expect(child.id).toBe('scout-child');
      expect(child.info.parentID).toBe(parent.id);
      const messages = host.getMessages('scout-child');
      expect(Array.isArray(messages)).toBe(true);
      await host.promptAsync('scout-child', { text: 'also list the test entry points' });
      expect(host.getMessages(parent.id).some((entry) => (
        entry.parts?.some((part) => part.text === 'also list the test entry points')
      ))).toBe(false);
    } finally {
      if (originalTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalTmp;
    }
  });

  it('fills sessionID from the live subagent tool and drops leftover ghost files', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const tmpdir = path.join(home, 'tmp');
    const originalTmp = process.env.TMPDIR;
    process.env.TMPDIR = tmpdir;
    const host = createPiHost({
      home,
      defaultDirectory: '/tmp/project',
      mock: true,
      createSession: async () => createInMemoryPiSession(),
    });
    const parent = await host.createSession({ directory: '/tmp/project', title: 'Parent' });
    for (let index = 0; index < 10; index += 1) {
      const runDir = path.join(tmpdir, 'pi-subagents-user', 'async-subagent-runs', `ghost_${index}`);
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'status.json'), JSON.stringify({
        runId: `ghost_${index}`,
        sessionId: parent.id,
        state: index === 9 ? 'failed' : 'complete',
        mode: index === 9 ? 'async' : 'sync',
      }));
    }
    parent.messages.push({
      info: { id: 'msg_asst', role: 'assistant', sessionID: parent.id },
      parts: [{
        id: 'prt_sub',
        type: 'tool',
        tool: 'subagent',
        callID: 'call_live',
        state: {
          status: 'error',
          input: { agent: 'scout', sessionId: 'child-live', task: 'List the README filename' },
          output: 'NotImplementedError: node:v8 createHook is not yet implemented in Bun',
        },
      }],
    });
    try {
      const listed = await host.listSubagentRuns(parent.id);
      expect(listed.runs).toEqual([expect.objectContaining({
        runId: 'call_live',
        sessionID: 'child-live',
        openable: true,
        name: 'scout',
      })]);
    } finally {
      if (originalTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalTmp;
    }
  });

  it('does not invent an openable session when the run has no child id', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const tmpdir = path.join(home, 'tmp');
    const runDir = path.join(tmpdir, 'pi-subagents-user', 'async-subagent-runs', 'run_early');
    fs.mkdirSync(runDir, { recursive: true });
    const originalTmp = process.env.TMPDIR;
    process.env.TMPDIR = tmpdir;
    const host = createPiHost({
      home,
      defaultDirectory: '/tmp/project',
      mock: true,
      createSession: async () => createInMemoryPiSession(),
    });
    const parent = await host.createSession({ directory: '/tmp/project', title: 'Parent' });
    fs.writeFileSync(path.join(runDir, 'status.json'), JSON.stringify({
      runId: 'run_early',
      sessionId: parent.id,
      state: 'queued',
      mode: 'async',
      steps: [{ agent: 'reviewer', status: 'queued' }],
    }));
    try {
      const listed = await host.listSubagentRuns(parent.id);
      expect(listed.runs[0]).toMatchObject({
        runId: 'run_early',
        sessionID: null,
        openable: false,
      });
      expect(await host.listSessionChildren(parent.id)).toEqual([]);
    } finally {
      if (originalTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalTmp;
    }
  });

  it('does not list or mint a child for a management list call', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const host = createPiHost({
      home,
      defaultDirectory: '/tmp/project',
      mock: true,
      createSession: async () => createInMemoryPiSession(),
    });
    const parent = await host.createSession({ directory: '/tmp/project', title: 'Parent' });
    parent.messages.push({
      info: { id: 'msg_asst', role: 'assistant', sessionID: parent.id },
      parts: [{
        id: 'prt_list',
        type: 'tool',
        tool: 'subagent',
        callID: 'call_list',
        state: {
          status: 'completed',
          input: { action: 'list' },
          output: JSON.stringify({ details: { mode: 'management', results: [] } }),
        },
      }],
    });
    const before = host.listSessions('/tmp/project').map((record) => record.id);
    const listed = await host.listSubagentRuns(parent.id);
    expect(listed.runs).toEqual([]);
    expect(await host.listSessionChildren(parent.id)).toEqual([]);
    expect(host.listSessions('/tmp/project').map((record) => record.id)).toEqual(before);
  });

  it('keeps an in-flight execution without a child id as status-only', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const host = createPiHost({
      home,
      defaultDirectory: '/tmp/project',
      mock: true,
      createSession: async () => createInMemoryPiSession(),
    });
    const parent = await host.createSession({ directory: '/tmp/project', title: 'Parent' });
    parent.messages.push({
      info: { id: 'msg_asst', role: 'assistant', sessionID: parent.id },
      parts: [{
        id: 'prt_sub',
        type: 'tool',
        tool: 'subagent',
        callID: 'call_live',
        state: {
          status: 'running',
          input: { agent: 'scout', task: 'List the README filename' },
        },
      }],
    });
    const before = host.listSessions('/tmp/project').map((record) => record.id);
    const listed = await host.listSubagentRuns(parent.id);
    expect(listed.runs).toEqual([expect.objectContaining({
      runId: 'call_live',
      name: 'scout',
      sessionID: null,
      openable: false,
    })]);
    expect(await host.listSessionChildren(parent.id)).toEqual([]);
    expect(host.listSessions('/tmp/project').map((record) => record.id)).toEqual(before);
  });

  it('does not mint an empty chat for a finished tool-call that never got a child id', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const host = createPiHost({
      home,
      defaultDirectory: '/tmp/project',
      mock: true,
      createSession: async () => createInMemoryPiSession(),
    });
    const parent = await host.createSession({ directory: '/tmp/project', title: 'Parent' });
    parent.messages.push({
      info: { id: 'msg_asst', role: 'assistant', sessionID: parent.id },
      parts: [{
        id: 'prt_sub',
        type: 'tool',
        tool: 'subagent',
        callID: 'call_live',
        state: {
          status: 'error',
          input: { agent: 'scout', task: 'List the README filename' },
          output: 'NotImplementedError: node:v8 createHook is not yet implemented in Bun',
        },
      }],
    });
    const before = host.listSessions('/tmp/project').map((record) => record.id);
    const listed = await host.listSubagentRuns(parent.id);
    expect(listed.runs).toEqual([]);
    expect(await host.listSessionChildren(parent.id)).toEqual([]);
    expect(host.listSessions('/tmp/project').map((record) => record.id)).toEqual(before);
  });

  it('lists /run from the Subagents slot and never treats the parent as the child', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const host = createPiHost({
      home,
      defaultDirectory: '/tmp/project',
      mock: true,
      createSession: async () => createInMemoryPiSession(),
    });
    expect(host.listCommands('/tmp/project').some((command) => (
      command.name === 'run' && command.source === 'extension'
    ))).toBe(true);
    const parent = await host.createSession({ directory: '/tmp/project', title: 'Parent' });
    parent.piSession.registerCommand('run', async (args) => {
      parent.messages.push({
        info: { id: 'msg_asst', role: 'assistant', sessionID: parent.id },
        parts: [{
          id: 'prt_sub',
          type: 'tool',
          tool: 'subagent',
          callID: 'call_run',
          state: {
            status: 'error',
            input: { agent: 'scout', sessionId: parent.id, task: args },
            output: 'NotImplementedError: node:v8 createHook is not yet implemented in Bun',
          },
        }],
      });
    }, { description: 'Run one subagent through workflowScript' });
    const result = await host.runCommand(parent.id, {
      command: 'run',
      arguments: 'scout 只回复一个词：ok',
    });
    expect(result.info.role).toBe('assistant');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const listed = await host.listSubagentRuns(parent.id);
    expect(listed.runs.every((run) => run.sessionID !== parent.id)).toBe(true);
    const texts = host.getMessages(parent.id).flatMap((entry) => (
      (entry.parts || []).map((part) => part.text).filter(Boolean)
    ));
    expect(texts.some((text) => text.includes('Could not start a subagent run'))).toBe(true);
    expect(host.getStatus()[parent.id]).toBeUndefined();
    host.dispose();
  });

  it('surfaces an error for bare /run and missing live /run instead of a silent chat turn', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const host = createPiHost({
      home,
      defaultDirectory: '/tmp/project',
      mock: true,
      createSession: async () => createInMemoryPiSession(),
    });
    const parent = await host.createSession({ directory: '/tmp/project', title: 'Parent' });
    const bare = await host.runCommand(parent.id, { command: 'run', arguments: '' });
    expect(bare.parts[0].text).toMatch(/needs an agent and a task/);
    expect(host.getMessages(parent.id).some((entry) => (
      entry.parts?.some((part) => part.text === '/run')
    ))).toBe(true);
    await expect(host.runCommand(parent.id, { command: 'run', arguments: 'scout ok' }))
      .rejects.toMatchObject({ status: 404, message: 'Command /run is not available on this session' });
    host.dispose();
  });

  it('surfaces an error when /run hangs without creating a child', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const host = createPiHost({
      home,
      defaultDirectory: '/tmp/project',
      mock: true,
      createSession: async () => createInMemoryPiSession(),
    });
    const parent = await host.createSession({ directory: '/tmp/project', title: 'Parent' });
    parent.piSession.registerCommand('run', async () => new Promise(() => {}), {
      description: 'Run one subagent through workflowScript',
    });
    await host.runCommand(parent.id, { command: 'run', arguments: 'scout say ok' });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const texts = host.getMessages(parent.id).flatMap((entry) => (
      (entry.parts || []).map((part) => part.text).filter(Boolean)
    ));
    expect(texts.some((text) => text.includes('Could not start a subagent run'))).toBe(true);
    expect(host.getStatus()[parent.id]).toBeUndefined();
    host.dispose();
  });

  it('surfaces an error when /run finishes without creating a child', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const host = createPiHost({
      home,
      defaultDirectory: '/tmp/project',
      mock: true,
      createSession: async () => createInMemoryPiSession(),
    });
    const parent = await host.createSession({ directory: '/tmp/project', title: 'Parent' });
    parent.piSession.registerCommand('run', async () => {}, {
      description: 'Run one subagent through workflowScript',
    });
    await host.runCommand(parent.id, { command: 'run', arguments: 'scout say ok' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const texts = host.getMessages(parent.id).flatMap((entry) => (
      (entry.parts || []).map((part) => part.text).filter(Boolean)
    ));
    expect(texts.some((text) => text.includes('Could not start a subagent run'))).toBe(true);
    expect(host.getStatus()[parent.id]).toBeUndefined();
    host.dispose();
  });
});
