import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeFeaturePlugins } from './feature-plugins.js';
import { createInMemoryPiSession, createPiHost, sessionDirForCwd } from './pi-host.js';
import {
  PICHAMBER_METADATA_CUSTOM_TYPE,
  readPersistedSessionMetadataFromFile,
} from './session-metadata.js';
import { applySessionListQuery } from './session-list-query.js';

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

const writeAdapterChildRun = ({
  home,
  parentID,
  childId = 'scout-child',
  runId = 'run_scout',
  directory = '/tmp/project',
  userText = 'Inspect the repo',
} = {}) => {
  const tmpdir = path.join(home, 'tmp');
  const runDir = path.join(tmpdir, 'pi-subagents-user', 'async-subagent-runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  const childFile = path.join(runDir, 'child.jsonl');
  fs.writeFileSync(childFile, `${JSON.stringify({
    type: 'session',
    id: childId,
    cwd: directory,
  })}\n${JSON.stringify({
    type: 'message',
    id: 'msg_user',
    role: 'user',
    content: userText,
    timestamp: new Date().toISOString(),
  })}\n`);
  fs.writeFileSync(path.join(runDir, 'status.json'), JSON.stringify({
    runId,
    sessionId: parentID,
    state: 'running',
    mode: 'async',
    sessionFile: childFile,
    steps: [{ agent: 'scout', status: 'running', sessionFile: childFile }],
  }));
  return { tmpdir, childFile, childId, runId };
};

const createMockHost = (home, { onEvent } = {}) => createPiHost({
  home,
  defaultDirectory: '/tmp/project',
  mock: true,
  onEvent,
  createSession: async ({ sessionManager } = {}) => {
    const persistedId = typeof sessionManager?.getSessionId === 'function'
      ? sessionManager.getSessionId()
      : undefined;
    return createInMemoryPiSession(persistedId ? { sessionId: persistedId } : {});
  },
});

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

  it('does not retry attaching a cleaned-up status session file', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const tmpdir = path.join(home, 'tmp');
    const originalTmp = process.env.TMPDIR;
    process.env.TMPDIR = tmpdir;
    const runId = 'run_cleaned_up';
    const missingSessionFile = path.join(tmpdir, 'removed', 'session.jsonl');
    const runDir = path.join(tmpdir, 'pi-subagents-user', 'async-subagent-runs', runId);
    fs.mkdirSync(runDir, { recursive: true });
    const host = createPiHost({
      home,
      defaultDirectory: '/tmp/project',
      mock: true,
      createSession: async () => createInMemoryPiSession(),
    });
    const parent = await host.createSession({ directory: '/tmp/project', title: 'Parent' });
    fs.writeFileSync(path.join(runDir, 'status.json'), JSON.stringify({
      runId,
      sessionId: parent.id,
      state: 'running',
      mode: 'async',
      sessionFile: missingSessionFile,
    }));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      expect(await host.listSubagentRuns(parent.id)).toEqual({
        runs: [expect.objectContaining({
          runId,
          state: 'running',
          sessionID: null,
          openable: false,
        })],
      });
      expect(warning).not.toHaveBeenCalled();
    } finally {
      warning.mockRestore();
      if (originalTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalTmp;
      host.dispose();
    }
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
    expect(host.listCommands('/tmp/project').find((command) => command.name === 'run')).toMatchObject({
      description: 'Run a subagent as a one-shot workflow',
    });
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

  it('skips re-reading an unchanged child jsonl and refreshes when the file changes', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const tmpdir = path.join(home, 'tmp');
    const runDir = path.join(tmpdir, 'pi-subagents-user', 'async-subagent-runs', 'run_scout');
    fs.mkdirSync(runDir, { recursive: true });
    const childFile = path.join(runDir, 'child.jsonl');
    const writeChild = (extraLines = []) => {
      fs.writeFileSync(childFile, [
        JSON.stringify({ type: 'session', id: 'scout-child', cwd: '/tmp/project' }),
        JSON.stringify({
          type: 'message',
          id: 'msg_user',
          message: { role: 'user', content: [{ type: 'text', text: 'Inspect the repo' }] },
        }),
        ...extraLines,
      ].map((line) => `${line}\n`).join(''));
    };
    writeChild();

    const originalTmp = process.env.TMPDIR;
    process.env.TMPDIR = tmpdir;
    const originalReadFileSync = fs.readFileSync;
    const childReads = [];
    fs.readFileSync = function patchedReadFileSync(file, options) {
      if (path.resolve(String(file)) === path.resolve(childFile)) {
        childReads.push(String(file));
      }
      return originalReadFileSync.call(this, file, options);
    };
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
      expect(listed.runs[0]).toMatchObject({ sessionID: 'scout-child', openable: true, directory: '/tmp/project' });
      const afterAttach = childReads.length;
      expect(afterAttach).toBeGreaterThan(0);
      expect(host.getMessages('scout-child').some((entry) => (
        entry.parts?.some((part) => part.text === 'Inspect the repo')
      ))).toBe(true);
      await host.listSubagentRuns(parent.id);
      host.getMessages('scout-child');
      expect(childReads.length).toBe(afterAttach);

      writeChild([JSON.stringify({
        type: 'message',
        id: 'msg_more',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Found the test entry points' }] },
      })]);
      const afterChange = host.getMessages('scout-child');
      expect(childReads.length).toBeGreaterThan(afterAttach);
      expect(afterChange.some((entry) => (
        entry.parts?.some((part) => part.text === 'Found the test entry points')
      ))).toBe(true);
    } finally {
      fs.readFileSync = originalReadFileSync;
      if (originalTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalTmp;
      host.dispose();
    }
  });

  it('attaches a nested herdr/subagent session.jsonl by header id without a sessionFile path', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const host = createPiHost({
      home,
      defaultDirectory: '/tmp/project',
      createModelRuntime: async () => ({ getAvailable: async () => [] }),
      createDirectoryRuntime: async ({ cwd }) => ({ session: null, directory: cwd }),
      createSession: async ({ sessionManager } = {}) => createInMemoryPiSession({
        sessionId: typeof sessionManager?.getSessionId === 'function'
          ? sessionManager.getSessionId()
          : undefined,
      }),
    });
    const parent = await host.createSession({ directory: '/tmp/project', title: 'Parent' });
    const childId = 'nested-child';
    const childFile = path.join(
      sessionDirForCwd('/tmp/project', home),
      `${parent.id}`,
      'run_scout',
      'run-0',
      'session.jsonl',
    );
    fs.mkdirSync(path.dirname(childFile), { recursive: true });
    fs.writeFileSync(childFile, `${JSON.stringify({
      type: 'session',
      id: childId,
      cwd: '/tmp/project',
    })}\n${JSON.stringify({
      type: 'message',
      id: 'msg_user',
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: [{ type: 'text', text: 'Inspect the nested session' }] },
    })}\n`);
    parent.messages.push({
      info: { id: 'msg_asst', role: 'assistant', sessionID: parent.id },
      parts: [{
        id: 'prt_sub',
        type: 'tool',
        tool: 'subagent',
        callID: 'call_nested',
        state: {
          status: 'running',
          input: { agent: 'scout', sessionId: childId, task: 'Inspect the repo' },
        },
      }],
    });

    const listed = await host.listSessionInfos('/tmp/project');
    expect(listed.find((info) => info.id === childId)).toMatchObject({
      id: childId,
      parentID: parent.id,
    });
    const opened = await host.ensureSession(childId, '/tmp/project');
    expect(opened.id).toBe(childId);
    expect(opened.sessionFile).toBe(childFile);
    expect(host.getMessages(childId).some((entry) => (
      entry.parts?.some((part) => part.text === 'Inspect the nested session')
    ))).toBe(true);
    host.dispose();
  });

  it('rereads a nested child jsonl on getMessages after the file grows', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const host = createPiHost({
      home,
      defaultDirectory: '/tmp/project',
      createModelRuntime: async () => ({ getAvailable: async () => [] }),
      createDirectoryRuntime: async ({ cwd }) => ({ session: null, directory: cwd }),
      createSession: async ({ sessionManager } = {}) => createInMemoryPiSession({
        sessionId: typeof sessionManager?.getSessionId === 'function'
          ? sessionManager.getSessionId()
          : undefined,
      }),
    });
    const parent = await host.createSession({ directory: '/tmp/project', title: 'Parent' });
    const childId = 'nested-grow';
    const childFile = path.join(
      sessionDirForCwd('/tmp/project', home),
      `${parent.id}`,
      'run_disk',
      'run-0',
      'session.jsonl',
    );
    fs.mkdirSync(path.dirname(childFile), { recursive: true });
    const writeChild = (extra = []) => {
      fs.writeFileSync(childFile, [
        JSON.stringify({ type: 'session', id: childId, cwd: '/tmp/project' }),
        JSON.stringify({
          type: 'message',
          id: 'msg_user',
          timestamp: new Date().toISOString(),
          message: { role: 'user', content: [{ type: 'text', text: 'Task: check disk' }] },
        }),
        ...extra,
      ].map((line) => `${line}\n`).join(''));
    };
    writeChild();
    const opened = await host.ensureSession(childId, '/tmp/project');
    expect(opened.id).toBe(childId);
    expect(host.getMessages(childId).map((entry) => entry.info.role)).toEqual(['user']);
    writeChild([JSON.stringify({
      type: 'message',
      id: 'msg_asst',
      timestamp: new Date().toISOString(),
      message: { role: 'assistant', content: [{ type: 'text', text: 'df -h looks fine' }] },
    })]);
    const afterGrow = host.getMessages(childId);
    expect(afterGrow.some((entry) => (
      entry.parts?.some((part) => part.text === 'df -h looks fine')
    ))).toBe(true);
    host.dispose();
  });

  it('includes adapter children on listSessionInfos without a prior subagent-runs call', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const events = [];
    const originalTmp = process.env.TMPDIR;
    const host = createMockHost(home, {
      onEvent(_directory, event) {
        events.push(event);
      },
    });
    const parent = await host.createSession({ directory: '/tmp/project', title: 'Parent' });
    const { tmpdir, childFile, childId } = writeAdapterChildRun({ home, parentID: parent.id });
    process.env.TMPDIR = tmpdir;
    try {
      const listed = await host.listSessionInfos('/tmp/project');
      const child = listed.find((info) => info.id === childId);
      expect(child).toMatchObject({
        id: childId,
        parentID: parent.id,
      });
      expect(child.id.startsWith('ses_')).toBe(false);
      expect(listed.some((info) => info.id.startsWith('ses_') && info.parentID === parent.id)).toBe(false);
      expect(await host.listSessionChildren(parent.id)).toEqual([
        expect.objectContaining({ id: childId, parentID: parent.id }),
      ]);
      expect(applySessionListQuery(listed, { roots: true }).sessions.map((info) => info.id))
        .not.toContain(childId);
      expect(applySessionListQuery(listed, {}).sessions.map((info) => info.id))
        .toEqual(expect.arrayContaining([parent.id, childId]));
      expect(readPersistedSessionMetadataFromFile(childFile)).toEqual(expect.objectContaining({
        parentID: parent.id,
      }));
      expect(events.some((event) => (
        (event?.type === 'session.created' || event?.type === 'session.updated')
        && event.properties?.info?.id === childId
        && event.properties?.info?.parentID === parent.id
      ))).toBe(true);

      const attached = host.getSession(childId);
      delete attached.info.parentID;
      if (attached.info.metadata) delete attached.info.metadata.parentID;
      events.length = 0;
      const relisted = await host.listSessionInfos('/tmp/project');
      expect(relisted.find((info) => info.id === childId)?.parentID).toBe(parent.id);
      expect(events.some((event) => (
        event?.type === 'session.updated'
        && event.properties?.info?.id === childId
        && event.properties?.info?.parentID === parent.id
      ))).toBe(true);

      await host.promptAsync(childId, { text: 'also list the test entry points' });
      expect(host.getMessages(parent.id).some((entry) => (
        entry.parts?.some((part) => part.text === 'also list the test entry points')
      ))).toBe(false);
      expect(host.getMessages(childId).some((entry) => (
        entry.parts?.some((part) => part.text === 'also list the test entry points')
      ))).toBe(true);

      host.dispose();
      const restarted = createPiHost({
        home,
        defaultDirectory: '/tmp/project',
        mock: true,
        createSession: async () => createInMemoryPiSession({ sessionId: parent.id }),
      });
      await restarted.createSession({ directory: '/tmp/project', title: 'Parent' });
      const cold = await restarted.listSessionInfos('/tmp/project');
      expect(cold.find((info) => info.id === childId)).toMatchObject({
        id: childId,
        parentID: parent.id,
      });
      expect(readPersistedSessionMetadataFromFile(childFile)).toEqual(expect.objectContaining({
        parentID: parent.id,
      }));
      restarted.dispose();
    } finally {
      if (originalTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalTmp;
    }
  });

  it('hides adapter children from the session list when the slot is off', async () => {
    const home = makeHome();
    const originalTmp = process.env.TMPDIR;
    const host = createMockHost(home);
    const parent = await host.createSession({ directory: '/tmp/project', title: 'Parent' });
    const leftover = await host.createSession({
      directory: '/tmp/project',
      title: 'Leftover clone',
      parentID: parent.id,
    });
    const { tmpdir, childId } = writeAdapterChildRun({ home, parentID: parent.id });
    process.env.TMPDIR = tmpdir;
    try {
      const listed = await host.listSessionInfos('/tmp/project');
      expect(listed.map((info) => info.id)).toEqual(expect.arrayContaining([parent.id, leftover.id]));
      expect(listed.map((info) => info.id)).not.toContain(childId);
      expect(await host.listSessionChildren(parent.id)).toEqual([]);
    } finally {
      if (originalTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalTmp;
      host.dispose();
    }
  });

  it('does not mint an empty session from listSessionInfos for management or finished calls', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const host = createMockHost(home);
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
      }, {
        id: 'prt_done',
        type: 'tool',
        tool: 'subagent',
        callID: 'call_done',
        state: {
          status: 'error',
          input: { agent: 'scout', task: 'List the README filename' },
          output: 'NotImplementedError: node:v8 createHook is not yet implemented in Bun',
        },
      }],
    });
    const before = (await host.listSessionInfos('/tmp/project')).map((info) => info.id);
    const listed = await host.listSessionInfos('/tmp/project');
    expect(listed.map((info) => info.id)).toEqual(before);
    expect(listed.filter((info) => info.parentID === parent.id)).toEqual([]);
    expect(await host.listSessionChildren(parent.id)).toEqual([]);
    host.dispose();
  });

  it('does not reparent an existing top-level chat from a debug.run dump', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const host = createMockHost(home);
    const parent = await host.createSession({ directory: '/tmp/project', title: 'Packaging' });
    const sibling = await host.createSession({ directory: '/tmp/project', title: 'Lody' });
    const siblingFile = path.join(
      sessionDirForCwd('/tmp/project', home),
      `2026-08-28T11-52-33-467Z_${sibling.id}.jsonl`,
    );
    fs.mkdirSync(path.dirname(siblingFile), { recursive: true });
    fs.writeFileSync(siblingFile, `${JSON.stringify({
      type: 'session',
      id: sibling.id,
      cwd: '/tmp/project',
    })}\n${JSON.stringify({
      type: 'message',
      id: 'msg_user',
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: [{ type: 'text', text: 'https://github.com/LodyAI/Lody' }] },
    })}\n`);
    sibling.sessionFile = siblingFile;
    parent.messages.push({
      info: { id: 'msg_asst', role: 'assistant', sessionID: parent.id },
      parts: [{
        id: 'prt_debug',
        type: 'tool',
        tool: 'subagent',
        callID: 'call_debug',
        state: {
          status: 'completed',
          input: { action: 'debug.run', id: '41584961-a3ae-4c57-9163-84b1a0b8a65a' },
          output: `Debug run\nSession: ${siblingFile}`,
        },
      }],
    });

    const listed = await host.listSessionInfos('/tmp/project');
    expect(listed.find((info) => info.id === sibling.id)?.parentID).toBeUndefined();
    expect(sibling.info.parentID).toBeUndefined();
    expect(readPersistedSessionMetadataFromFile(siblingFile)?.parentID).toBeUndefined();
    host.dispose();
  });

  it('lists a top-level chat as a root when stolen subagentRun metadata is already on disk', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const host = createMockHost(home);
    const parent = await host.createSession({ directory: '/tmp/project', title: 'Packaging' });
    const sibling = await host.createSession({ directory: '/tmp/project', title: 'Lody' });
    const siblingFile = path.join(
      sessionDirForCwd('/tmp/project', home),
      `2026-08-28T11-52-33-467Z_${sibling.id}.jsonl`,
    );
    fs.mkdirSync(path.dirname(siblingFile), { recursive: true });
    fs.writeFileSync(siblingFile, `${JSON.stringify({
      type: 'session',
      id: sibling.id,
      cwd: '/tmp/project',
    })}\n${JSON.stringify({
      type: 'custom',
      customType: 'pichamber.metadata',
      data: {
        parentID: parent.id,
        pichamber: { subagentRun: { parentSessionID: parent.id, runId: 'call_debug' } },
      },
    })}\n`);
    sibling.sessionFile = siblingFile;
    sibling.info.parentID = parent.id;
    sibling.info.metadata = {
      parentID: parent.id,
      pichamber: { subagentRun: { parentSessionID: parent.id, runId: 'call_debug' } },
    };

    const listed = await host.listSessionInfos('/tmp/project');
    expect(listed.find((info) => info.id === sibling.id)?.parentID).toBeUndefined();
    expect(sibling.info.parentID).toBeUndefined();
    host.dispose();
  });

  it('does not attach a subagent file onto the in-memory mock when fallback is closed', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    let calls = 0;
    const host = createPiHost({
      home,
      defaultDirectory: '/tmp/project',
      allowInMemoryFallback: false,
      createModelRuntime: async () => ({ getAvailable: async () => [] }),
      createDirectoryRuntime: async ({ cwd }) => ({ session: null, directory: cwd }),
      createSession: async ({ sessionManager } = {}) => {
        calls += 1;
        if (calls > 1) {
          throw Object.assign(new Error('Pi node kernel did not become ready'), {
            code: 'PI_NODE_UNAVAILABLE',
            status: 503,
          });
        }
        return createInMemoryPiSession({
          sessionId: typeof sessionManager?.getSessionId === 'function'
            ? sessionManager.getSessionId()
            : undefined,
        });
      },
    });
    const parent = await host.createSession({ directory: '/tmp/project', title: 'Parent' });
    const { tmpdir, childId } = writeAdapterChildRun({ home, parentID: parent.id });
    const originalTmp = process.env.TMPDIR;
    process.env.TMPDIR = tmpdir;
    try {
      await host.listSessionInfos('/tmp/project');
      expect(() => host.getSession(childId)).toThrow(/Session not found/);
      await expect(host.ensureSession(childId, '/tmp/project')).rejects.toMatchObject({
        code: 'PI_NODE_UNAVAILABLE',
        status: 503,
      });
      expect(() => host.getSession(childId)).toThrow(/Session not found/);
    } finally {
      if (originalTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalTmp;
      host.dispose();
    }
  });

  it('lists a worktree-cwd child under the parent directory when parentID is already set', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const host = createMockHost(home);
    const parentDir = '/tmp/pichamber-348-fixture/parent';
    const childDir = '/tmp/pichamber-348-fixture/child-wt';
    const parent = await host.createSession({ directory: parentDir, title: 'Parent' });
    const child = await host.createSession({
      directory: childDir,
      title: 'Scout',
      parentID: parent.id,
    });
    const listed = host.listSessions(parentDir);
    expect(listed.map((record) => record.id)).toEqual(expect.arrayContaining([parent.id, child.id]));
    expect(listed.find((record) => record.id === child.id)).toMatchObject({
      directory: childDir,
      info: expect.objectContaining({ parentID: parent.id }),
    });
    const infos = await host.listSessionInfos(parentDir);
    expect(infos.find((info) => info.id === child.id)).toMatchObject({
      id: child.id,
      parentID: parent.id,
      directory: childDir,
    });
    host.dispose();
  });

  it('does not list an unrelated worktree session under the parent directory', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const host = createMockHost(home);
    const parentDir = '/tmp/pichamber-348-fixture/parent';
    const parent = await host.createSession({ directory: parentDir, title: 'Parent' });
    const unrelated = await host.createSession({
      directory: '/tmp/pichamber-348-fixture/other-wt',
      title: 'Other worktree',
    });
    const listed = host.listSessions(parentDir);
    expect(listed.map((record) => record.id)).toEqual([parent.id]);
    expect(listed.map((record) => record.id)).not.toContain(unrelated.id);
    const infos = await host.listSessionInfos(parentDir);
    expect(infos.map((info) => info.id)).toEqual([parent.id]);
    host.dispose();
  });

  it('lists a nested run-0/session.jsonl child with the worktree cwd', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const parentDir = '/tmp/pichamber-348-fixture/parent';
    const childDir = '/tmp/pichamber-348-fixture/child-wt';
    const host = createMockHost(home);
    const parent = await host.createSession({ directory: parentDir, title: 'Parent' });
    const childId = '01a04ce8-3480-7001-8002-pichamber34802';
    const childFile = path.join(
      sessionDirForCwd(parentDir, home),
      `${parent.id}`,
      'run_scout',
      'run-0',
      'session.jsonl',
    );
    fs.mkdirSync(path.dirname(childFile), { recursive: true });
    fs.writeFileSync(childFile, `${JSON.stringify({
      type: 'session',
      id: childId,
      cwd: childDir,
    })}\n${JSON.stringify({
      type: 'message',
      id: 'msg_user',
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: [{ type: 'text', text: 'Scout the worktree' }] },
    })}\n`);
    expect(parent.messages).toEqual([]);
    const listed = await host.listSubagentRuns(parent.id);
    expect(listed.runs).toEqual([expect.objectContaining({
      sessionID: childId,
      directory: childDir,
      openable: true,
    })]);
    host.dispose();
  });

  it('lists a nested child jsonl for an unhydrated parent without status.json', async () => {
    const home = makeHome();
    enableSubagentsSlot(home);
    const originalTmp = process.env.TMPDIR;
    process.env.TMPDIR = path.join(home, 'tmp');
    const parentId = '01a04836-e9bb-7f89-b60b-5b9346813f73';
    const childId = 'nested-unhydrated-child';
    const sessionDir = sessionDirForCwd('/tmp/project', home);
    fs.mkdirSync(sessionDir, { recursive: true });
    const parentFile = path.join(sessionDir, `2026-08-28T11-52-33-467Z_${parentId}.jsonl`);
    fs.writeFileSync(parentFile, `${JSON.stringify({
      type: 'session',
      id: parentId,
      cwd: '/tmp/project',
    })}\n${JSON.stringify({
      type: 'message',
      id: 'msg_parent',
      timestamp: '2026-08-28T11:52:33.467Z',
      message: { role: 'user', content: [{ type: 'text', text: 'Parent prompt' }] },
    })}\n`);
    const childFile = path.join(sessionDir, parentId, 'run_scout', 'run-0', 'session.jsonl');
    fs.mkdirSync(path.dirname(childFile), { recursive: true });
    fs.writeFileSync(childFile, `${JSON.stringify({
      type: 'session',
      id: childId,
      cwd: '/tmp/project',
    })}\n${JSON.stringify({
      type: 'custom',
      customType: PICHAMBER_METADATA_CUSTOM_TYPE,
      data: { parentID: parentId },
    })}\n${JSON.stringify({
      type: 'message',
      id: 'msg_child',
      timestamp: '2026-08-28T11:53:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'Inspect without status.json' }] },
    })}\n`);

    try {
      const host = createPiHost({
        home,
        defaultDirectory: '/tmp/project',
        createModelRuntime: async () => ({ getAvailable: async () => [] }),
        createDirectoryRuntime: async ({ cwd }) => ({ session: null, directory: cwd }),
        createSession: async ({ sessionManager } = {}) => createInMemoryPiSession({
          sessionId: typeof sessionManager?.getSessionId === 'function'
            ? sessionManager.getSessionId()
            : undefined,
        }),
        async listPersistedSessionsInDir() {
          const stat = fs.statSync(parentFile);
          return [{
            id: parentId,
            path: parentFile,
            cwd: '/tmp/project',
            created: stat.birthtime || stat.mtime,
            modified: stat.mtime,
            firstMessage: 'Parent prompt',
          }];
        },
      });

      expect(host.listSessions('/tmp/project')).toEqual([]);
      const listed = await host.listSessionInfos('/tmp/project');
      expect(listed.find((info) => info.id === parentId)).toMatchObject({
        id: parentId,
      });
      expect(listed.find((info) => info.id === parentId)?.parentID).toBeUndefined();
      expect(listed.find((info) => info.id === childId)).toMatchObject({
        id: childId,
        parentID: parentId,
      });
      expect(listed.some((info) => info.parentID === parentId && info.id !== childId)).toBe(false);
      host.dispose();
    } finally {
      if (originalTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalTmp;
    }
  });
});
