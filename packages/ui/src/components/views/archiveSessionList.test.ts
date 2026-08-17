import { describe, expect, test } from 'bun:test';

import {
  filterArchivedSessions,
  isActiveSessionRecord,
  sortArchivedSessionsByTime,
} from './archiveSessionList';

const session = (id: string, title: string, archived: number | null | undefined, directory = '/proj') => ({
  id,
  title,
  directory,
  time: archived === undefined ? undefined : { archived },
});

describe('archive session list', () => {
  test('treats a missing or zero archived timestamp as active (restored)', () => {
    expect(isActiveSessionRecord(session('a', 'Open', undefined))).toBe(true);
    expect(isActiveSessionRecord(session('b', 'Restored', 0))).toBe(true);
    expect(isActiveSessionRecord(session('c', 'Archived', 1_700_000_000_000))).toBe(false);
  });

  test('sorts archived sessions by archived time, newest first', () => {
    const older = session('old', 'Older', 100);
    const newer = session('new', 'Newer', 200);
    expect(sortArchivedSessionsByTime([older, newer]).map((entry) => entry.id)).toEqual(['new', 'old']);
  });

  test('search matches titles and ignores the directory filter', () => {
    const sessions = [
      session('a', 'Fix login', 10, '/alpha'),
      session('b', 'Ship billing', 20, '/beta'),
    ];
    expect(filterArchivedSessions(sessions, {
      query: 'LOGIN',
      selectedDirectory: '/beta',
      getDirectory: (entry) => entry.directory,
    }).map((entry) => entry.id)).toEqual(['a']);
  });

  test('without a query, the directory filter keeps only that project', () => {
    const sessions = [
      session('a', 'Fix login', 10, '/alpha'),
      session('b', 'Ship billing', 20, '/beta'),
    ];
    expect(filterArchivedSessions(sessions, {
      query: '  ',
      selectedDirectory: '/beta',
      getDirectory: (entry) => entry.directory,
    }).map((entry) => entry.id)).toEqual(['b']);
  });

  test('null directory and empty query return every archived session', () => {
    const sessions = [
      session('a', 'Fix login', 10, '/alpha'),
      session('b', 'Ship billing', 20, '/beta'),
    ];
    expect(filterArchivedSessions(sessions, {
      query: '',
      selectedDirectory: null,
      getDirectory: (entry) => entry.directory,
    })).toHaveLength(2);
  });

  test('restoring writes archived=0 so the chat returns to the active list', () => {
    const archived = session('chat', 'Yesterday', 1_700_000_000_000);
    expect(isActiveSessionRecord(archived)).toBe(false);
    const restored = { ...archived, time: { archived: 0 } };
    expect(isActiveSessionRecord(restored)).toBe(true);
  });
});
