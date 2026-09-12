import { describe, expect, test } from 'bun:test';

import { countMatchingSessionNodes, filterSessionNodesForSearch, isSessionIdSearchQuery, sessionSearchTextMatches } from './sessionSearch';

type Node = {
  session: { title: string };
  children: Node[];
};

const node = (title: string, children: Node[] = []): Node => ({
  session: { title },
  children,
});

const text = (session: { title: string }) => session.title.toLowerCase();

describe('sidebar search match count', () => {
  const tree = [
    node('long-scout', [
      node('scout-wt'),
      node('scout-b'),
    ]),
  ];

  test('does not count a parent ancestor that only provides context', () => {
    const query = 'scout-wt';
    const filtered = filterSessionNodesForSearch(tree, query, text);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.session.title).toBe('long-scout');
    expect(filtered[0]?.children.map((child) => child.session.title)).toEqual(['scout-wt']);
    expect(countMatchingSessionNodes(filtered, query, text)).toBe(1);
  });

  test('counts only matching session rows for scout / child / long', () => {
    expect(countMatchingSessionNodes(
      filterSessionNodesForSearch(tree, 'scout', text),
      'scout',
      text,
    )).toBe(3);
    expect(countMatchingSessionNodes(
      filterSessionNodesForSearch(tree, 'child', text),
      'child',
      text,
    )).toBe(0);
    expect(countMatchingSessionNodes(
      filterSessionNodesForSearch([
        node('parent', [node('child-a'), node('child-b')]),
      ], 'child', text),
      'child',
      text,
    )).toBe(2);
    expect(countMatchingSessionNodes(
      filterSessionNodesForSearch(tree, 'long', text),
      'long',
      text,
    )).toBe(1);
  });
});

describe('sidebar session search matcher', () => {
  const tree = [node('renamed-scan')];

  test('prefix and substring queries still match the title', () => {
    expect(sessionSearchTextMatches('renamed-scan', 'renam')).toBe(true);
    expect(sessionSearchTextMatches('renamed-scan', 'named')).toBe(true);
    expect(filterSessionNodesForSearch(tree, 'renam', text)).toHaveLength(1);
    expect(countMatchingSessionNodes(tree, 'renam', text)).toBe(1);
  });

  test('trailing extra characters that are not in the title do not match', () => {
    expect(sessionSearchTextMatches('renamed-scan', 'renamzzz')).toBe(false);
    expect(filterSessionNodesForSearch(tree, 'renamzzz', text)).toEqual([]);
    expect(countMatchingSessionNodes(tree, 'renamzzz', text)).toBe(0);
  });
});


describe('sidebar exact session id search', () => {
  const text = (session: { title?: string | null }) => (session.title ?? '').toLowerCase();
  const tree = [
    {
      session: { id: 'ses_f88b1a2b3c4d', title: 'Release notes', time: {} },
      children: [
        { session: { id: 'ses_child', title: 'Child', time: {} }, children: [] },
      ],
    },
    {
      session: { id: 'ses_other', title: 'ses_f88b1a2b3c4d', time: {} },
      children: [],
    },
  ];

  test('matches only a complete ID (case/whitespace insensitive)', () => {
    expect(isSessionIdSearchQuery('  SES_F88B1A2B3C4D ')).toBe(true);
    const filtered = filterSessionNodesForSearch(tree as never, '  SES_F88B1A2B3C4D ', text as never);
    expect(filtered.map((n) => n.session.id)).toEqual(['ses_f88b1a2b3c4d']);
    expect(countMatchingSessionNodes(filtered as never, 'ses_f88b1a2b3c4d', text as never)).toBe(1);
    expect(filterSessionNodesForSearch(tree as never, 'ses_f88b', text as never)).toEqual([]);
  });

  test('skips archived sessions for id queries unless opted in', () => {
    const archived = [{
      session: { id: 'ses_f88b1a2b3c4d', title: 'Archived', time: { archived: 2 } },
      children: [],
    }];
    expect(filterSessionNodesForSearch(archived as never, 'ses_f88b1a2b3c4d', text as never)).toEqual([]);
    expect(filterSessionNodesForSearch(archived as never, 'ses_f88b1a2b3c4d', text as never, { includeArchivedForIdQuery: true }).map((n) => n.session.id)).toEqual(['ses_f88b1a2b3c4d']);
  });
});
