import { describe, expect, test } from 'bun:test';

import { countMatchingSessionNodes, filterSessionNodesForSearch } from './sessionSearch';

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
