
/** Full session id paste: exact match only (case/whitespace insensitive). */
export const isSessionIdSearchQuery = (query: string): boolean => {
  const normalized = query.trim().toLowerCase();
  return normalized.startsWith('ses_');
};

export const normalizeSessionIdSearchQuery = (query: string): string => query.trim().toLowerCase();

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
  options: { readonly includeArchivedForIdQuery?: boolean } = {},
): T[] => {
  if (!query) {
    return nodes;
  }

  const normalizedQuery = normalizeSessionIdSearchQuery(query);
  const idQuery = isSessionIdSearchQuery(query);

  return nodes.flatMap((node) => {
    const session = node.session as T['session'] & {
      id?: string;
      time?: { archived?: number | null };
    };
    if (idQuery && !options.includeArchivedForIdQuery && Boolean(session?.time?.archived)) {
      return [];
    }
    const nodeMatches = idQuery
      ? typeof session?.id === 'string' && session.id.toLowerCase() === normalizedQuery
      : sessionSearchTextMatches(getSearchText(node.session), query);
    const filteredChildren = filterSessionNodesForSearch(
      node.children as T[],
      query,
      getSearchText,
      options,
    );
    if (nodeMatches) {
      // Keep the matched node intact (children included). ID queries count only
      // exact id hits via countMatchingSessionNodes.
      return [node];
    }
    if (filteredChildren.length > 0) {
      return [{ ...node, children: filteredChildren } as T];
    }
    return [];
  });
};


/** Count sessions whose own text matches. Ancestor context rows do not increment. */
export const countMatchingSessionNodes = <T extends SearchableSessionNode>(
  nodes: T[],
  query: string,
  getSearchText: (session: T['session']) => string,
): number => {
  const idQuery = isSessionIdSearchQuery(query);
  const normalizedQuery = normalizeSessionIdSearchQuery(query);
  const walk = (list: T[]): number => list.reduce((total, node) => {
    const session = node.session as T['session'] & { id?: string };
    const self = idQuery
      ? (typeof session?.id === 'string' && session.id.toLowerCase() === normalizedQuery ? 1 : 0)
      : (sessionSearchTextMatches(getSearchText(node.session), query) ? 1 : 0);
    return total + self + walk(node.children as T[]);
  }, 0);
  return walk(filterSessionNodesForSearch(nodes, query, getSearchText));
};

