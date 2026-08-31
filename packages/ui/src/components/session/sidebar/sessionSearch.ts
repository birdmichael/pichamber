export type SearchableSessionNode<TSession = { title?: string | null }> = {
  session: TSession;
  children: Array<SearchableSessionNode<TSession>>;
};

/**
 * Prefix/substring match for sidebar session search.
 *
 * Fuse/subsequence matching treats leftover query characters as typos, so
 * `renamzzz` would still hit `renamed-scan`. Extra characters that are not a
 * contiguous substring of the title (or other search text) must fail. Keep
 * useful prefix and mid-string matches (`renam`, `named`) so search stays
 * usable.
 */
export const sessionSearchTextMatches = (haystack: string, query: string): boolean => {
  if (!query) {
    return true;
  }
  if (!haystack) {
    return false;
  }
  return haystack.includes(query);
};

/**
 * Keep matching sessions, plus a non-matching ancestor so the tree still
 * shows where a child hit lives. The ancestor is context only.
 */
export const filterSessionNodesForSearch = <T extends SearchableSessionNode>(
  nodes: T[],
  query: string,
  getSearchText: (session: T['session']) => string,
): T[] => {
  if (!query) {
    return nodes;
  }

  return nodes.flatMap((node) => {
    const nodeMatches = sessionSearchTextMatches(getSearchText(node.session), query);
    if (nodeMatches) {
      return [node];
    }

    const filteredChildren = filterSessionNodesForSearch(node.children as T[], query, getSearchText);
    if (filteredChildren.length === 0) {
      return [];
    }

    return [{ ...node, children: filteredChildren }];
  });
};

/** Count sessions whose own text matches. Ancestor context rows do not increment. */
export const countMatchingSessionNodes = <T extends SearchableSessionNode>(
  nodes: T[],
  query: string,
  getSearchText: (session: T['session']) => string,
): number => {
  if (!query) {
    return 0;
  }

  return nodes.reduce((total, node) => {
    const matches = sessionSearchTextMatches(getSearchText(node.session), query);
    return total + (matches ? 1 : 0) + countMatchingSessionNodes(node.children as T[], query, getSearchText);
  }, 0);
};
