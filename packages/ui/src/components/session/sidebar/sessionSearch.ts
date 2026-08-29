export type SearchableSessionNode<TSession = { title?: string | null }> = {
  session: TSession;
  children: Array<SearchableSessionNode<TSession>>;
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
    const nodeMatches = getSearchText(node.session).includes(query);
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
    const matches = getSearchText(node.session).includes(query);
    return total + (matches ? 1 : 0) + countMatchingSessionNodes(node.children as T[], query, getSearchText);
  }, 0);
};
