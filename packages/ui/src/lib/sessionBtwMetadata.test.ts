import { describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';
import { getSessionMetadata } from './sessionReviewMetadata';
import {
  getBtwBoundaryMessageID,
  getBtwOriginalSessionID,
  getBtwSessionID,
  filterListedSessions,
  isBtwSession,
  isHiddenBtwSession,
  withBtwSessionLink,
  withBtwSessionMarker,
  withoutBtwSessionLink,
  withoutBtwSessionMarker,
} from './sessionBtwMetadata';

const session = (id: string, metadata?: Record<string, unknown>): Session => ({
  id,
  title: id,
  time: { created: 1, updated: 1 },
  metadata,
} as unknown as Session);

describe('sessionBtwMetadata', () => {
  test('reads the parent link and fork marker', () => {
    const parent = session('parent', { openchamber: { btwSessionID: 'fork-1' } });
    const fork = session('fork-1', {
      openchamber: { kind: 'btw', originalSessionID: 'parent', btwBoundaryMessageID: 'msg-9' },
    });

    expect(getBtwSessionID(parent)).toBe('fork-1');
    expect(isBtwSession(fork)).toBe(true);
    expect(isHiddenBtwSession(fork)).toBe(true);
    expect(isHiddenBtwSession(parent)).toBe(false);
    expect(getBtwOriginalSessionID(fork)).toBe('parent');
    expect(getBtwBoundaryMessageID(fork)).toBe('msg-9');
  });

  test('a kind without originalSessionID is not a btw session', () => {
    const bogus = session('x', { openchamber: { kind: 'btw' } });
    expect(isBtwSession(bogus)).toBe(false);
    expect(isHiddenBtwSession(bogus)).toBe(false);
  });

  test('lists omit a marked fork until Keep, and Discard never lists it', () => {
    const parent = session('parent', { openchamber: { btwSessionID: 'fork-1' } });
    const fork = session('fork-1', {
      openchamber: { kind: 'btw', originalSessionID: 'parent', btwBoundaryMessageID: 'msg-9' },
    });
    expect(filterListedSessions([parent, fork]).map((item) => item.id)).toEqual(['parent']);
    const kept = session('fork-1', withoutBtwSessionMarker(getSessionMetadata(fork)));
    expect(filterListedSessions([parent, kept]).map((item) => item.id)).toEqual(['parent', 'fork-1']);
    expect(filterListedSessions([parent]).map((item) => item.id)).toEqual(['parent']);
  });

  test('Keep drops the marker so the fork is listable', () => {
    const marked = withBtwSessionMarker({}, 'parent-1', 'msg-1');
    expect(marked).toEqual({
      openchamber: { kind: 'btw', originalSessionID: 'parent-1', btwBoundaryMessageID: 'msg-1' },
    });
    expect(isHiddenBtwSession(session('fork', marked))).toBe(true);
    expect(withoutBtwSessionMarker(marked)).toEqual({});
    expect(isHiddenBtwSession(session('fork', withoutBtwSessionMarker(marked)))).toBe(false);
  });

  test('Discard unlinks only the matching fork', () => {
    const linked = withBtwSessionLink({}, 'fork-1');
    expect(withoutBtwSessionLink(linked, 'fork-1')).toEqual({});
    expect(withoutBtwSessionLink(linked, 'other')).toEqual(linked);
  });

  test('an empty parent marker has no boundary', () => {
    const marked = withBtwSessionMarker({}, 'parent-1', null);
    expect(marked).toEqual({ openchamber: { kind: 'btw', originalSessionID: 'parent-1' } });
    expect(getBtwBoundaryMessageID(session('fork', marked))).toBe(null);
  });
});
