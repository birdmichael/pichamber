import { describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';

import { collectMultiRunSiblings, collectMultiRunSiblingsFromAnchors } from './siblings';

const session = (id: string, title: string, created = 1): Session => ({
  id,
  title,
  time: { created, updated: created },
} as Session);

describe('collectMultiRunSiblings', () => {
  test('groups isolated worktree runs that share a slug', () => {
    const first = session('a', 'remain-cmp/xai/grok-4.6/1', 1);
    const second = session('b', 'remain-cmp/xai/grok-4.6/2', 2);
    const other = session('c', 'other-group/xai/grok-4.6/1', 3);

    expect(collectMultiRunSiblings(first, [first, second, other]).map((item) => item.id)).toEqual(['a', 'b']);
  });

  test('keeps run groups separate and ignores fusion as a column', () => {
    const g1 = session('a', 'bench/g1/anthropic/claude', 1);
    const g2 = session('b', 'bench/g2/anthropic/claude', 2);
    const fusion = session('c', 'bench/g1/anthropic/claude/fusion', 3);

    expect(collectMultiRunSiblings(g1, [g1, g2, fusion]).map((item) => item.id)).toEqual(['a']);
    expect(collectMultiRunSiblings(fusion, [g1, g2, fusion]).map((item) => item.id)).toEqual(['a']);
  });

  test('collects siblings from every anchor in a worktree group', () => {
    const first = session('a', 'remain-cmp/xai/grok-4.6/1', 2);
    const second = session('b', 'remain-cmp/xai/grok-4.6/2', 1);
    const unrelated = session('c', 'plain chat', 3);

    expect(collectMultiRunSiblingsFromAnchors([first, unrelated], [first, second, unrelated]).map((item) => item.id))
      .toEqual(['b', 'a']);
  });
});
