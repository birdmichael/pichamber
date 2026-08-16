import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { SessionManager, CURRENT_SESSION_VERSION } from '@earendil-works/pi-coding-agent';
import { createPiHost, sessionDirForCwd } from './pi-host.js';

const tempDirs = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const tempDir = (prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const stubSession = (sessionId) => ({
  sessionId,
  isStreaming: false,
  subscribe() {
    return () => {};
  },
  async prompt() {},
  async abort() {},
  dispose() {},
});

const writePersistedSession = ({ home, cwd, title, userText, assistantText }) => {
  const sessionDir = sessionDirForCwd(cwd, home);
  const manager = SessionManager.create(cwd, sessionDir);
  const file = manager.getSessionFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({
    type: 'session',
    version: CURRENT_SESSION_VERSION,
    id: manager.getSessionId(),
    timestamp: new Date().toISOString(),
    cwd: manager.getCwd(),
  })}\n`);
  const opened = SessionManager.open(file, sessionDir);
  if (title) opened.appendSessionInfo(title);
  if (userText) {
    opened.appendMessage({
      role: 'user',
      content: [{ type: 'text', text: userText }],
      timestamp: Date.now(),
    });
  }
  if (assistantText) {
    opened.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: assistantText }],
      timestamp: Date.now(),
    });
  }
  return {
    id: opened.getSessionId(),
    path: opened.getSessionFile(),
  };
};

const createHost = ({ home, cwd }) => createPiHost({
  home,
  defaultDirectory: cwd,
  createModelRuntime: async () => ({ getAvailable: async () => [] }),
  createDirectoryRuntime: async ({ cwd: directory }) => ({ session: null, directory }),
  createSession: async ({ sessionManager }) => stubSession(
    typeof sessionManager?.getSessionId === 'function'
      ? sessionManager.getSessionId()
      : undefined,
  ),
});

describe('persisted Pi sessions', () => {
  it('lists a disk session, hydrates get/message, and reopens the same id after a new host instance', async () => {
    const home = tempDir('pi-persist-home-');
    const cwd = path.join(home, 'project');
    fs.mkdirSync(cwd, { recursive: true });
    const persisted = writePersistedSession({
      home,
      cwd,
      title: 'Depth review',
      userText: '帮我深度体验 Pichamber',
      assistantText: '已从磁盘恢复',
    });
    expect(persisted.id).not.toMatch(/^ses_/);
    expect(fs.existsSync(persisted.path)).toBe(true);

    const first = createHost({ home, cwd });
    const listed = await first.listPersistedSessions(cwd);
    expect(listed.map((item) => item.id)).toContain(persisted.id);
    expect(listed.find((item) => item.id === persisted.id).firstMessage).toContain('深度体验');

    const record = await first.ensureSession(persisted.id, cwd);
    expect(record.info.id).toBe(persisted.id);
    expect(record.info.title).toBe('Depth review');
    const messages = first.getMessages(persisted.id);
    expect(messages.map((entry) => entry.info.role)).toEqual(['user', 'assistant']);
    expect(messages[0].parts[0].text).toBe('帮我深度体验 Pichamber');
    expect(messages[1].parts[0].text).toBe('已从磁盘恢复');
    first.dispose();

    const restarted = createHost({ home, cwd });
    expect(restarted.listSessions(cwd)).toHaveLength(0);
    const afterRestart = await restarted.ensureSession(persisted.id, cwd);
    expect(afterRestart.info.id).toBe(persisted.id);
    const restartedMessages = restarted.getMessages(persisted.id);
    expect(restartedMessages).toHaveLength(2);
    expect(restartedMessages[0].parts[0].text).toBe('帮我深度体验 Pichamber');
    expect(restartedMessages[1].parts[0].text).toBe('已从磁盘恢复');
    restarted.dispose();
  });

  it('creates a session with a stable Pi UUID that survives a simulated restart', async () => {
    const home = tempDir('pi-persist-create-');
    const cwd = path.join(home, 'project');
    fs.mkdirSync(cwd, { recursive: true });

    const first = createHost({ home, cwd });
    const created = await first.createSession({ directory: cwd, title: 'Keep this id' });
    expect(created.id).not.toMatch(/^ses_/);
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created.sessionFile).toBeTruthy();
    expect(fs.existsSync(created.sessionFile)).toBe(true);
    expect(fs.readFileSync(created.sessionFile, 'utf8')).toContain(created.id);
    const createdId = created.id;
    first.dispose();

    const restarted = createHost({ home, cwd });
    const listed = await restarted.listPersistedSessions(cwd);
    expect(listed.map((item) => item.id)).toContain(createdId);
    const loaded = await restarted.ensureSession(createdId, cwd);
    expect(loaded.info.id).toBe(createdId);
    expect(loaded.info.title).toBe('Keep this id');
    restarted.dispose();
  });

  it('reloadSessionRecords re-lists disk sessions and re-reads the open transcript', async () => {
    const home = tempDir('pi-persist-records-');
    const cwd = path.join(home, 'project');
    fs.mkdirSync(cwd, { recursive: true });
    const open = writePersistedSession({
      home,
      cwd,
      title: 'Open row',
      userText: 'original question',
      assistantText: 'original answer',
    });
    const host = createHost({ home, cwd });
    await host.ensureSession(open.id, cwd);
    expect(host.getMessages(open.id)).toHaveLength(2);

    const sibling = writePersistedSession({
      home,
      cwd,
      title: 'Sibling from disk',
      userText: 'another client wrote this',
    });
    const opened = SessionManager.open(open.path, sessionDirForCwd(cwd, home));
    opened.appendMessage({
      role: 'user',
      content: [{ type: 'text', text: 'appended on disk' }],
      timestamp: Date.now(),
    });

    const result = await host.reloadSessionRecords({ sessionID: open.id, directory: cwd });
    expect(result.reloaded).toBe(true);
    expect(result.kernel).toBe('pi');
    expect(result.sessionID).toBe(open.id);
    expect(result.sessions.map((item) => item.id)).toEqual(expect.arrayContaining([open.id, sibling.id]));
    expect(result.messages.map((entry) => entry.parts?.[0]?.text)).toContain('appended on disk');
    expect(host.getMessages(open.id).map((entry) => entry.parts?.[0]?.text)).toContain('appended on disk');
    expect(host.listSessions(cwd).map((item) => item.id)).toContain(open.id);
    host.dispose();
  });

  it('reloadSessionRecords keeps a complete sibling when another session file is unreadable', async () => {
    const home = tempDir('pi-persist-partial-');
    const cwd = path.join(home, 'project');
    fs.mkdirSync(cwd, { recursive: true });
    const good = writePersistedSession({
      home,
      cwd,
      title: 'Good session',
      userText: 'keep this transcript',
      assistantText: 'still here',
    });
    const bad = writePersistedSession({
      home,
      cwd,
      title: 'Broken session',
      userText: 'will be corrupted',
    });
    const host = createHost({ home, cwd });
    await host.ensureSession(good.id, cwd);
    await host.ensureSession(bad.id, cwd);
    const before = host.getMessages(good.id);
    expect(before).toHaveLength(2);
    fs.writeFileSync(bad.path, '{not-json\n');

    const result = await host.reloadSessionRecords({ sessionID: good.id, directory: cwd });
    expect(result.sessionID).toBe(good.id);
    expect(host.getMessages(good.id).map((entry) => entry.parts?.[0]?.text)).toEqual([
      'keep this transcript',
      'still here',
    ]);
    expect(host.listSessions(cwd).map((item) => item.id).sort()).toEqual([bad.id, good.id].sort());
    expect(host.getSession(bad.id).info.title).toBe('Broken session');
    host.dispose();
  });

  it('persists Session Goal metadata on the Pi session and restores it after reload', async () => {
    const home = tempDir('pi-persist-goal-');
    const cwd = path.join(home, 'project');
    fs.mkdirSync(cwd, { recursive: true });
    const goal = {
      id: 'goal_restore',
      objective: 'Keep this goal',
      objectiveFile: false,
      status: 'active',
    };

    const first = createHost({ home, cwd });
    const created = await first.createSession({ directory: cwd, title: 'Goal session' });
    await first.updateSession(created.id, {
      metadata: { openchamber: { goal } },
    }, cwd);
    expect(created.info.metadata.openchamber.goal).toMatchObject(goal);
    const createdId = created.id;
    first.dispose();

    const restarted = createHost({ home, cwd });
    const loaded = await restarted.ensureSession(createdId, cwd);
    expect(loaded.info.id).toBe(createdId);
    expect(loaded.info.metadata?.openchamber?.goal).toMatchObject(goal);
    restarted.dispose();
  });

  it('persists archive on pichamber.metadata so a new host still reports time.archived', async () => {
    const home = tempDir('pi-persist-archive-');
    const cwd = path.join(home, 'project');
    fs.mkdirSync(cwd, { recursive: true });
    const sibling = writePersistedSession({
      home,
      cwd,
      title: 'Still active',
      userText: 'keep me open',
    });

    const first = createHost({ home, cwd });
    const created = await first.createSession({ directory: cwd, title: 'Archive me' });
    const archivedAt = 1_700_000_123_000;
    const archived = await first.updateSession(created.id, { time: { archived: archivedAt } }, cwd);
    expect(archived.info.time.archived).toBe(archivedAt);
    expect(archived.info.metadata.archived).toBe(archivedAt);
    const createdId = created.id;
    first.dispose();

    const restarted = createHost({ home, cwd });
    const listed = await restarted.listSessionInfos(cwd);
    const row = listed.find((session) => session.id === createdId);
    expect(row?.time.archived).toBe(archivedAt);
    const active = listed.filter((session) => !session.time?.archived);
    expect(active.map((session) => session.id)).toContain(sibling.id);
    expect(active.map((session) => session.id)).not.toContain(createdId);

    const loaded = await restarted.ensureSession(createdId, cwd);
    expect(loaded.info.time.archived).toBe(archivedAt);
    expect(loaded.info.metadata?.archived).toBe(archivedAt);

    const refreshed = await restarted.reloadSessionRecords({ sessionID: sibling.id, directory: cwd });
    expect(refreshed.sessions.find((session) => session.id === createdId)?.time.archived).toBe(archivedAt);
    expect(refreshed.sessions.filter((session) => !session.time?.archived).map((session) => session.id))
      .not.toContain(createdId);

    await restarted.updateSession(createdId, { time: { archived: 0 } }, cwd);
    restarted.dispose();

    const restoredHost = createHost({ home, cwd });
    const restoredList = await restoredHost.listSessionInfos(cwd);
    const restored = restoredList.find((session) => session.id === createdId);
    expect(restored?.time.archived).toBe(0);
    expect(Boolean(restored?.time.archived)).toBe(false);
    expect(restoredList.filter((session) => !session.time?.archived).map((session) => session.id))
      .toContain(createdId);
    const restoredRecord = await restoredHost.ensureSession(createdId, cwd);
    expect(restoredRecord.info.time.archived).toBe(0);
    restoredHost.dispose();
  });

  it('cloneSession persists messages and parentID so a new host hydrates the same transcript', async () => {
    const home = tempDir('pi-persist-clone-');
    const cwd = path.join(home, 'project');
    fs.mkdirSync(cwd, { recursive: true });
    const sessionDir = sessionDirForCwd(cwd, home);
    const manager = SessionManager.create(cwd, sessionDir);
    const file = manager.getSessionFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({
      type: 'session',
      version: CURRENT_SESSION_VERSION,
      id: manager.getSessionId(),
      timestamp: new Date().toISOString(),
      cwd: manager.getCwd(),
    })}\n`);
    const opened = SessionManager.open(file, sessionDir);
    opened.appendSessionInfo('Clone source');
    opened.appendMessage({
      role: 'user',
      content: [
        { type: 'text', text: 'see this' },
        { type: 'image', mimeType: 'image/png', data: 'AAAA' },
      ],
      timestamp: Date.now(),
    });
    opened.appendMessage({
      role: 'assistant',
      content: [
        { type: 'text', text: 'reading' },
        { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'SKILL.md' } },
      ],
      timestamp: Date.now(),
    });
    opened.appendMessage({
      role: 'toolResult',
      toolName: 'read',
      toolCallId: 'c1',
      content: [{ type: 'text', text: 'skill body' }],
      timestamp: Date.now(),
    });
    const sourceId = opened.getSessionId();

    const first = createHost({ home, cwd });
    await first.ensureSession(sourceId, cwd);
    const cloned = await first.cloneSession(sourceId);
    expect(cloned.id).not.toBe(sourceId);
    expect(cloned.info.parentID).toBe(sourceId);
    expect(cloned.messages.map((entry) => entry.info.role)).toEqual(['user', 'assistant']);
    const cloneId = cloned.id;
    first.dispose();

    const restarted = createHost({ home, cwd });
    const loaded = await restarted.ensureSession(cloneId, cwd);
    expect(loaded.info.parentID).toBe(sourceId);
    expect(loaded.info.metadata?.parentID).toBe(sourceId);
    const messages = restarted.getMessages(cloneId);
    expect(messages.map((entry) => entry.info.role)).toEqual(['user', 'assistant']);
    expect(messages[0].parts.map((part) => part.type)).toEqual(['text', 'file']);
    expect(messages[0].parts[0].text).toBe('see this');
    expect(messages[0].parts[1]).toMatchObject({
      type: 'file',
      mime: 'image/png',
      url: 'data:image/png;base64,AAAA',
    });
    expect(messages[1].parts.map((part) => part.type)).toEqual(['text', 'tool']);
    expect(messages[1].parts[0].text).toBe('reading');
    expect(messages[1].parts[1]).toMatchObject({
      type: 'tool',
      callID: 'c1',
      tool: 'read',
      state: { status: 'completed', input: { path: 'SKILL.md' }, output: 'skill body' },
    });
    const listed = await restarted.listSessionInfos(cwd);
    expect(listed.find((session) => session.id === cloneId)?.parentID).toBe(sourceId);
    restarted.dispose();
  });

  it('forkSession persists only the prefix so a new host hydrates that prefix and parentID', async () => {
    const home = tempDir('pi-persist-fork-');
    const cwd = path.join(home, 'project');
    fs.mkdirSync(cwd, { recursive: true });
    const persisted = writePersistedSession({
      home,
      cwd,
      title: 'Fork source',
      userText: 'first question',
      assistantText: 'first answer',
    });
    const opened = SessionManager.open(persisted.path, sessionDirForCwd(cwd, home));
    opened.appendMessage({
      role: 'user',
      content: [{ type: 'text', text: 'second question' }],
      timestamp: Date.now(),
    });
    opened.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'second answer' }],
      timestamp: Date.now(),
    });

    const first = createHost({ home, cwd });
    await first.ensureSession(persisted.id, cwd);
    const sourceMessages = first.getMessages(persisted.id);
    expect(sourceMessages).toHaveLength(4);
    const forkAt = sourceMessages[0].info.id;
    const forked = await first.forkSession(persisted.id, forkAt);
    expect(forked.info.parentID).toBe(persisted.id);
    expect(forked.messages.map((entry) => entry.parts?.[0]?.text)).toEqual(['first question']);
    const forkId = forked.id;
    first.dispose();

    const restarted = createHost({ home, cwd });
    const loaded = await restarted.ensureSession(forkId, cwd);
    expect(loaded.info.parentID).toBe(persisted.id);
    const messages = restarted.getMessages(forkId);
    expect(messages.map((entry) => entry.parts?.[0]?.text)).toEqual(['first question']);
    expect(messages.some((entry) => entry.parts?.some((part) => part.text === 'second question'))).toBe(false);
    restarted.dispose();
  });

  it('importSession writes a Pi jsonl transcript so a new host still has those messages', async () => {
    const home = tempDir('pi-persist-import-');
    const cwd = path.join(home, 'project');
    fs.mkdirSync(cwd, { recursive: true });
    const jsonl = [
      JSON.stringify({ type: 'session', cwd, version: CURRENT_SESSION_VERSION }),
      JSON.stringify({
        type: 'message',
        id: 'u1',
        message: { role: 'user', content: [{ type: 'text', text: 'imported hello' }] },
      }),
      JSON.stringify({
        type: 'message',
        id: 'a1',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'imported reply' },
            { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'SKILL.md' } },
          ],
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 't1',
        message: {
          role: 'toolResult',
          toolName: 'read',
          toolCallId: 'c1',
          content: [{ type: 'text', text: 'imported skill' }],
        },
      }),
    ].join('\n');

    const first = createHost({ home, cwd });
    const imported = await first.importSession({ jsonl, directory: cwd, title: 'Imported chat' });
    expect(imported.messages.map((entry) => entry.info.role)).toEqual(['user', 'assistant']);
    const importedId = imported.id;
    first.dispose();

    const restarted = createHost({ home, cwd });
    const loaded = await restarted.ensureSession(importedId, cwd);
    expect(loaded.info.title).toBe('Imported chat');
    const messages = restarted.getMessages(importedId);
    expect(messages.map((entry) => entry.info.role)).toEqual(['user', 'assistant']);
    expect(messages[0].parts[0].text).toBe('imported hello');
    expect(messages[1].parts.map((part) => part.type)).toEqual(['text', 'tool']);
    expect(messages[1].parts[0].text).toBe('imported reply');
    expect(messages[1].parts[1]).toMatchObject({
      type: 'tool',
      callID: 'c1',
      tool: 'read',
      state: { status: 'completed', output: 'imported skill' },
    });
    restarted.dispose();
  });
});
