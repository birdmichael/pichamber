import { describe, expect, it } from 'vitest';

import { applySessionListQuery, includeArchivedSessions } from './session-list-query.js';

const session = (id, { updated = 0, archived, parentID } = {}) => ({
  id,
  ...(parentID ? { parentID } : {}),
  time: {
    updated,
    ...(archived !== undefined ? { archived } : {}),
  },
});

describe('Pi session list query', () => {
  it('treats archived=false/absent as active + restored, and archived=true as inclusive', () => {
    expect(includeArchivedSessions(undefined)).toBe(false);
    expect(includeArchivedSessions('false')).toBe(false);
    expect(includeArchivedSessions(true)).toBe(true);
    expect(includeArchivedSessions('true')).toBe(true);

    const infos = [
      session('active', { updated: 30 }),
      session('restored', { updated: 20, archived: 0 }),
      session('archived', { updated: 10, archived: 9 }),
    ];
    expect(applySessionListQuery(infos, {}).sessions.map((item) => item.id))
      .toEqual(['active', 'restored']);
    expect(applySessionListQuery(infos, { archived: 'false' }).sessions.map((item) => item.id))
      .toEqual(['active', 'restored']);
    expect(applySessionListQuery(infos, { archived: 'true' }).sessions.map((item) => item.id))
      .toEqual(['active', 'restored', 'archived']);
  });

  it('keeps only sessions without parentID when roots=true', () => {
    const infos = [
      session('root', { updated: 20 }),
      session('child', { updated: 10, parentID: 'root' }),
    ];
    expect(applySessionListQuery(infos, { roots: 'true' }).sessions.map((item) => item.id))
      .toEqual(['root']);
    expect(applySessionListQuery(infos, { roots: false }).sessions.map((item) => item.id))
      .toEqual(['root', 'child']);
    expect(applySessionListQuery(infos, {}).sessions.map((item) => item.id))
      .toEqual(['root', 'child']);
  });

  it('pages by time.updated strictly earlier and reports x-next-cursor', () => {
    const infos = [
      session('newest', { updated: 300 }),
      session('middle', { updated: 200 }),
      session('oldest', { updated: 100 }),
    ];
    const first = applySessionListQuery(infos, { limit: 1 });
    expect(first.sessions.map((item) => item.id)).toEqual(['newest']);
    expect(first.nextCursor).toBe(300);

    const second = applySessionListQuery(infos, { limit: 1, cursor: first.nextCursor });
    expect(second.sessions.map((item) => item.id)).toEqual(['middle']);
    expect(second.nextCursor).toBe(200);

    const third = applySessionListQuery(infos, { limit: 1, cursor: second.nextCursor });
    expect(third.sessions.map((item) => item.id)).toEqual(['oldest']);
    expect(third.nextCursor).toBeUndefined();
  });

  it('ignores invalid limit/cursor instead of emptying the list', () => {
    const infos = [session('only', { updated: 5 })];
    expect(applySessionListQuery(infos, { limit: 'nope' }).sessions).toHaveLength(1);
    expect(applySessionListQuery(infos, { limit: 0 }).sessions).toHaveLength(1);
    expect(applySessionListQuery(infos, { cursor: 'nope' }).sessions).toHaveLength(1);
  });
});
