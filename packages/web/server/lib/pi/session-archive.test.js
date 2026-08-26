import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  SESSION_ARCHIVE_DIRNAME,
  activeSessionFilePath,
  archivedSessionFilePath,
  findSessionJsonlById,
  findSessionJsonlInDir,
  isUnderSessionArchiveDir,
  moveSessionFile,
  readSessionIdFromJsonlHeader,
  relocateSessionFileForArchiveState,
  sessionArchiveDir,
} from './session-archive.js';

const tempDirs = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-session-archive-'));
  tempDirs.push(dir);
  return dir;
};

const writeJsonl = (file, text = '{"type":"session"}\n') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};

describe('session archive directory', () => {
  it('moves archived jsonl into sibling archive/ and restore moves it back', () => {
    const sessionDir = tempDir();
    const file = writeJsonl(path.join(sessionDir, '2026_ses_active.jsonl'), 'active\n');
    const archived = relocateSessionFileForArchiveState(file, sessionDir, true);
    expect(archived).toBe(path.join(sessionDir, SESSION_ARCHIVE_DIRNAME, '2026_ses_active.jsonl'));
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readFileSync(archived, 'utf8')).toBe('active\n');
    expect(isUnderSessionArchiveDir(archived, sessionDir)).toBe(true);

    const restored = relocateSessionFileForArchiveState(archived, sessionDir, false);
    expect(restored).toBe(file);
    expect(fs.existsSync(archived)).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe('active\n');
    expect(isUnderSessionArchiveDir(restored, sessionDir)).toBe(false);
  });

  it('does not overwrite an existing dest and leaves the source in place', () => {
    const sessionDir = tempDir();
    const source = writeJsonl(path.join(sessionDir, 'dup.jsonl'), 'source\n');
    const dest = writeJsonl(path.join(sessionDir, SESSION_ARCHIVE_DIRNAME, 'dup.jsonl'), 'kept\n');
    expect(moveSessionFile(source, dest)).toBe(source);
    expect(fs.readFileSync(source, 'utf8')).toBe('source\n');
    expect(fs.readFileSync(dest, 'utf8')).toBe('kept\n');
  });

  it('finds a session jsonl in archive/ without walking other subdirs', () => {
    const sessionDir = tempDir();
    writeJsonl(path.join(sessionDir, '2026_ses_active.jsonl'));
    writeJsonl(path.join(sessionDir, SESSION_ARCHIVE_DIRNAME, '2026_ses_archived.jsonl'));
    writeJsonl(path.join(sessionDir, 'other', '2026_ses_hidden.jsonl'));
    expect(findSessionJsonlInDir(sessionDir, 'ses_active')).toBe(
      path.join(sessionDir, '2026_ses_active.jsonl'),
    );
    expect(findSessionJsonlInDir(sessionArchiveDir(sessionDir), 'ses_archived')).toBe(
      path.join(sessionDir, SESSION_ARCHIVE_DIRNAME, '2026_ses_archived.jsonl'),
    );
    expect(findSessionJsonlInDir(sessionDir, 'ses_hidden')).toBeUndefined();
    expect(findSessionJsonlInDir(sessionDir, 'ses_archived')).toBeUndefined();
  });

  it('finds nested herdr/subagent session.jsonl by header id and skips archive/', () => {
    const sessionDir = tempDir();
    const parentFile = writeJsonl(path.join(sessionDir, 'parent-abc.jsonl'), `${JSON.stringify({
      type: 'session',
      id: 'parent-abc',
    })}\n`);
    const childFile = writeJsonl(
      path.join(sessionDir, 'parent-abc', 'run_scout', 'run-0', 'session.jsonl'),
      `${JSON.stringify({
        type: 'session',
        id: 'child-uuid',
        cwd: '/tmp/project',
      })}\n`,
    );
    writeJsonl(
      path.join(sessionDir, SESSION_ARCHIVE_DIRNAME, 'session.jsonl'),
      `${JSON.stringify({ type: 'session', id: 'child-uuid' })}\n`,
    );
    expect(readSessionIdFromJsonlHeader(childFile)).toBe('child-uuid');
    expect(findSessionJsonlInDir(sessionDir, 'child-uuid')).toBeUndefined();
    expect(findSessionJsonlById(sessionDir, 'child-uuid')).toBe(childFile);
    expect(findSessionJsonlById(sessionDir, 'parent-abc')).toBe(parentFile);
    expect(findSessionJsonlById(sessionDir, 'child-uuid', { skipArchive: true })).toBe(childFile);
  });

  it('keeps path helpers scoped to the session dir basename', () => {
    const sessionDir = path.join(tempDir(), 'project-sessions');
    const file = path.join(sessionDir, 'leaf.jsonl');
    expect(sessionArchiveDir(sessionDir)).toBe(path.join(sessionDir, SESSION_ARCHIVE_DIRNAME));
    expect(archivedSessionFilePath(sessionDir, file)).toBe(
      path.join(sessionDir, SESSION_ARCHIVE_DIRNAME, 'leaf.jsonl'),
    );
    expect(activeSessionFilePath(sessionDir, path.join(sessionDir, SESSION_ARCHIVE_DIRNAME, 'leaf.jsonl')))
      .toBe(file);
  });
});
