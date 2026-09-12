import { describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';
import { buildSessionRetentionCandidates } from './session-retention';

const session = (partial: Partial<Session> & Pick<Session, 'id'>): Session => ({
  id: partial.id,
  title: partial.title ?? partial.id,
  version: '1',
  time: {
    created: partial.time?.created ?? 1_000,
    updated: partial.time?.updated ?? 1_000,
    archived: partial.time?.archived,
  },
  parentID: partial.parentID,
  share: partial.share,
} as Session);

describe('buildSessionRetentionCandidates', () => {
  test('keeps the five newest active sessions and the open session', () => {
    const now = 100 * 86_400_000;
    const sessions = Array.from({ length: 8 }, (_, index) => session({
      id: `s${index}`,
      time: { created: now - (index + 10) * 86_400_000, updated: now - (index + 10) * 86_400_000 },
    }));
    const ids = buildSessionRetentionCandidates({
      sessions,
      currentSessionId: 's7',
      cutoffDays: 7,
      action: 'archive',
      now,
    });
    expect(ids).not.toContain('s0');
    expect(ids).not.toContain('s1');
    expect(ids).not.toContain('s2');
    expect(ids).not.toContain('s3');
    expect(ids).not.toContain('s4');
    expect(ids).toContain('s5');
    expect(ids).toContain('s6');
    expect(ids).not.toContain('s7');
  });

  test('archived-only deletes use archive time and protect parents of retained children', () => {
    const now = 100 * 86_400_000;
    const fillers = Array.from({ length: 5 }, (_, index) => session({
      id: `keep${index}`,
      time: { created: 1, updated: 1, archived: now - index * 86_400_000 },
    }));
    const parent = session({
      id: 'parent',
      time: { created: 1, updated: 1, archived: now - 40 * 86_400_000 },
    });
    const child = session({
      id: 'child',
      parentID: 'parent',
      time: { created: 1, updated: 1, archived: now - 1 * 86_400_000 },
    });
    const old = session({
      id: 'old',
      time: { created: 1, updated: 1, archived: now - 40 * 86_400_000 },
    });
    const ids = buildSessionRetentionCandidates({
      sessions: [...fillers, parent, child, old],
      currentSessionId: null,
      cutoffDays: 30,
      action: 'delete',
      onlyArchived: true,
      now,
    });
    expect(ids).toContain('old');
    expect(ids).not.toContain('parent');
    expect(ids).not.toContain('child');
  });

  test('delete orders children before parents', () => {
    const now = 100 * 86_400_000;
    const fillers = Array.from({ length: 5 }, (_, index) => session({
      id: `keep${index}`,
      time: { created: 1, updated: now - index * 86_400_000 },
    }));
    const parent = session({
      id: 'parent',
      time: { created: 1, updated: now - 40 * 86_400_000 },
    });
    const child = session({
      id: 'child',
      parentID: 'parent',
      time: { created: 1, updated: now - 41 * 86_400_000 },
    });
    const ids = buildSessionRetentionCandidates({
      sessions: [...fillers, parent, child],
      currentSessionId: null,
      cutoffDays: 7,
      action: 'delete',
      now,
    });
    expect(ids).toContain('child');
    expect(ids).toContain('parent');
    expect(ids.indexOf('child')).toBeLessThan(ids.indexOf('parent'));
  });
});
