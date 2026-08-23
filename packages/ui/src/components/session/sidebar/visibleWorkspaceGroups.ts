import { normalizePath } from '@/lib/pathNormalization';

export const normalizeOpenedProjectPaths = (openedProjectPaths: Iterable<string>): Set<string> => {
  const paths = new Set<string>();
  for (const projectPath of openedProjectPaths) {
    const normalized = normalizePath(projectPath);
    if (normalized) paths.add(normalized);
  }
  return paths;
};

export const isOpenedProjectPath = (
  directory: string | null | undefined,
  openedProjectPaths: ReadonlySet<string>,
): boolean => {
  const normalized = normalizePath(directory ?? null);
  return Boolean(normalized && openedProjectPaths.has(normalized));
};

/**
 * Sidebar worktree groups are leftovers unless they have sessions or are
 * themselves an opened Settings project. Empty ghost paths (Cursor/cloud
 * worktrees, tmp checkouts, unused linked worktrees) must not clutter the
 * sidebar. An opened project with zero sessions still renders once via its
 * project-root group, not through this helper.
 */
export const shouldRenderSidebarWorktreeGroup = (input: {
  directory: string | null | undefined;
  sessionCount: number;
  openedProjectPaths: ReadonlySet<string>;
}): boolean => {
  if (input.sessionCount > 0) return true;
  return isOpenedProjectPath(input.directory, input.openedProjectPaths);
};
