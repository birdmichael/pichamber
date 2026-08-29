import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import type { WorktreeMetadata } from '@/types/worktree';
import type { SessionGroup, SessionNode } from '../types';
import {
  dedupeSessionsById,
  getArchivedScopeKey,
  normalizeForBranchComparison,
  normalizePath,
} from '../utils';
import { compareSessionsByLifecycleOrder, getSessionLifecycleOrderValue } from '@/sync/session-ordering';
import { formatDirectoryName, formatPathForDisplay } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { resolveSessionDisplayTitle } from '@/lib/sessionTitle';
import { resolveGlobalSessionDirectory } from '@/stores/useGlobalSessionsStore';
import { getWorktreeFirstSeenAt } from '../worktreeFirstSeen';
import { shouldRenderSidebarWorktreeGroup } from '../visibleWorkspaceGroups';
import { isHiddenBtwSession } from '@/lib/sessionBtwMetadata';
import { filterSessionNodesForSearch as filterSearchableSessionNodes } from '../sessionSearch';

type Args = {
  homeDirectory: string | null;
  openedProjectPaths: ReadonlySet<string>;
  worktreeMetadata: Map<string, WorktreeMetadata>;
  pinnedSessionIds: Set<string>;
  sessionOrderRanks: ReadonlyMap<string, number>;
  gitBranches: Map<string, string | null>;
  isVSCode: boolean;
};

const isArchivedSession = (session: { time?: { archived?: number | string | null } }): boolean => (
  Boolean(session.time?.archived)
);

type SessionParentFields = {
  id: string;
  parentID?: string | null;
  time?: { archived?: number | string | null };
};

export const nestSessionsByParentID = <T extends SessionParentFields>(
  sessions: readonly T[],
): { roots: T[]; childrenByParent: Map<string, T[]> } => {
  const sessionMap = new Map(sessions.map((session) => [session.id, session]));
  const childrenByParent = new Map<string, T[]>();
  for (const session of sessions) {
    const parentID = session.parentID;
    if (!parentID) continue;
    const parentSession = sessionMap.get(parentID);
    if (!parentSession || isArchivedSession(parentSession) !== isArchivedSession(session)) {
      continue;
    }
    const collection = childrenByParent.get(parentID) ?? [];
    collection.push(session);
    childrenByParent.set(parentID, collection);
  }
  const roots = sessions.filter((session) => {
    const parentID = session.parentID;
    if (!parentID) return true;
    const parentSession = sessionMap.get(parentID);
    if (!parentSession) return true;
    return isArchivedSession(parentSession) !== isArchivedSession(session);
  });
  return { roots, childrenByParent };
};

export const useSessionGrouping = (args: Args) => {
  const { t } = useI18n();
  const buildGroupSearchText = React.useCallback((group: SessionGroup): string => {
    return [group.label, group.branch ?? '', group.description ?? '', group.directory ?? ''].join(' ').toLowerCase();
  }, []);

  const buildSessionSearchText = React.useCallback((session: Session): string => {
    const sessionDirectory = normalizePath((session as Session & { directory?: string | null }).directory ?? null) ?? '';
    const rawTitle = typeof session.title === 'string' ? session.title.trim() : '';
    const sessionTitle = resolveSessionDisplayTitle(
      session.title,
      t('sessions.sidebar.session.untitled'),
    );
    return `${sessionTitle} ${rawTitle} ${sessionDirectory}`.toLowerCase();
  }, [t]);

  const filterSessionNodesForSearch = React.useCallback(
    (nodes: SessionNode[], query: string): SessionNode[] => (
      filterSearchableSessionNodes(nodes, query, buildSessionSearchText)
    ),
    [buildSessionSearchText],
  );

  const buildGroupedSessions = React.useCallback(
    (
      projectSessions: Session[],
      projectRoot: string | null,
      availableWorktrees: WorktreeMetadata[],
      projectRootBranch: string | null,
      projectIsRepo: boolean,
    ) => {
      const normalizedProjectRoot = normalizePath(projectRoot ?? null);
      const sortedProjectSessions = dedupeSessionsById(projectSessions)
        .filter((session) => !isHiddenBtwSession(session))
        .sort((a, b) => compareSessionsByLifecycleOrder(a, b, args.pinnedSessionIds, args.sessionOrderRanks));

      const { roots, childrenByParent } = nestSessionsByParentID(
        sortedProjectSessions as Array<Session & { parentID?: string | null }>,
      );
      childrenByParent.forEach((list) => list.sort((a, b) => compareSessionsByLifecycleOrder(a, b, args.pinnedSessionIds, args.sessionOrderRanks)));

      const worktreeByPath = new Map<string, WorktreeMetadata>();
      availableWorktrees.forEach((meta) => {
        if (meta.path) {
          const normalized = normalizePath(meta.path) ?? meta.path;
          worktreeByPath.set(normalized, meta);
        }
      });

      const getSessionWorktree = (session: Session): WorktreeMetadata | null => {
        const sessionDirectory = normalizePath((session as Session & { directory?: string | null }).directory ?? null);
        const sessionWorktreeMeta = args.worktreeMetadata.get(session.id) ?? null;
        if (sessionWorktreeMeta) return sessionWorktreeMeta;
        if (sessionDirectory) {
          const worktree = worktreeByPath.get(sessionDirectory) ?? null;
          if (worktree && sessionDirectory !== normalizedProjectRoot) {
            return worktree;
          }
        }
        return null;
      };

      const buildProjectNode = (session: Session): SessionNode => {
        const children = childrenByParent.get(session.id) ?? [];
        return { session, children: children.map((child) => buildProjectNode(child)), worktree: getSessionWorktree(session) };
      };

      const groupedNodes = new Map<string, SessionNode[]>();
      const archivedKey = '__archived__';

      // Applied only to roots. A child with a valid parentID in this list stays
      // nested under that parent even when child.directory is a worktree.
      const getGroupKey = (session: Session) => {
        if (session.time?.archived) return archivedKey;
        // VS Code groups by open workspace, not by worktree: every non-archived
        // session in a project belongs to that project's single (root) group.
        // Worktrees aren't registered in VS Code, so the desktop directory-match
        // below would otherwise dump these sessions into the archived bucket.
        if (args.isVSCode) return normalizedProjectRoot ?? '__project_root__';
        const metadataPath = normalizePath(args.worktreeMetadata.get(session.id)?.path ?? null);
        const normalizedDir = metadataPath ?? resolveGlobalSessionDirectory(session);
        if (!normalizedDir) return archivedKey;
        if (normalizedDir !== normalizedProjectRoot && worktreeByPath.has(normalizedDir)) return normalizedDir;
        if (normalizedDir === normalizedProjectRoot) return normalizedProjectRoot ?? '__project_root__';
        return archivedKey;
      };

      roots.forEach((session) => {
        const node = buildProjectNode(session);
        const groupKey = getGroupKey(session);
        if (!groupedNodes.has(groupKey)) groupedNodes.set(groupKey, []);
        groupedNodes.get(groupKey)?.push(node);
      });

      const rootKey = normalizedProjectRoot ?? '__project_root__';
      const groups: SessionGroup[] = [{
        id: 'root',
        label: (projectIsRepo && projectRootBranch && projectRootBranch !== 'HEAD')
          ? t('sessions.sidebar.grouping.projectRootWithBranch', { branch: projectRootBranch })
          : t('sessions.sidebar.grouping.projectRoot'),
        branch: projectRootBranch ?? null,
        description: normalizedProjectRoot ? formatPathForDisplay(normalizedProjectRoot, args.homeDirectory) : null,
        isMain: true,
        isArchivedBucket: false,
        worktree: null,
        directory: normalizedProjectRoot,
        folderScopeKey: normalizedProjectRoot,
        sessions: groupedNodes.get(rootKey) ?? [],
      }];

      // Calculate display-order activity for each worktree.
      const worktreeActivityInfo = new Map<string, { hasActiveSession: boolean; lastUpdatedAt: number }>();
      availableWorktrees.forEach((meta) => {
        const directory = normalizePath(meta.path) ?? meta.path;
        const sessionsInWorktree = groupedNodes.get(directory) ?? [];
        const hasActiveSession = sessionsInWorktree.length > 0;
        // Lifecycle rank wins when present; timestamps seed bootstrap ordering.
        const lastUpdatedAt = sessionsInWorktree.reduce((max, node) => {
          const updatedAt = getSessionLifecycleOrderValue(node.session, args.sessionOrderRanks);
          if (!Number.isFinite(updatedAt)) {
            return max;
          }
          return Math.max(max, updatedAt);
        }, 0);

        worktreeActivityInfo.set(directory, { hasActiveSession, lastUpdatedAt });
      });

      // Sort populated worktrees by shared session activity, then empty ones by label.
      const sortedWorktrees = [...availableWorktrees].sort((a, b) => {
        const aDir = normalizePath(a.path) ?? a.path;
        const bDir = normalizePath(b.path) ?? b.path;
        const aInfo = worktreeActivityInfo.get(aDir) ?? { hasActiveSession: false, lastUpdatedAt: 0 };
        const bInfo = worktreeActivityInfo.get(bDir) ?? { hasActiveSession: false, lastUpdatedAt: 0 };

        // First priority: active status (active first)
        if (aInfo.hasActiveSession !== bInfo.hasActiveSession) {
          return aInfo.hasActiveSession ? -1 : 1;
        }

        // Second priority: for populated worktrees, sort by latest display activity.
        if (aInfo.hasActiveSession && bInfo.hasActiveSession) {
          return bInfo.lastUpdatedAt - aInfo.lastUpdatedAt;
        }

        // Third priority: for inactive worktrees, most recently discovered
        // first (a worktree created mid-session surfaces at the top of the
        // list; startup discovery ties and falls through to labels).
        const aSeen = getWorktreeFirstSeenAt(a.path);
        const bSeen = getWorktreeFirstSeenAt(b.path);
        if (aSeen !== bSeen) {
          return bSeen - aSeen;
        }

        // Fourth priority: sort by label (asc)
        const aLabel = (a.label || a.branch || a.name || a.path || '').toLowerCase();
        const bLabel = (b.label || b.branch || b.name || b.path || '').toLowerCase();
        return aLabel.localeCompare(bLabel);
      });

      // VS Code groups strictly by open workspace — no per-worktree subgroups.
      // Empty leftover worktrees (Cursor/cloud checkouts, unused tmp paths)
      // stay off the sidebar unless they are themselves an opened project.
      const worktreeGroups = args.isVSCode
        ? []
        : sortedWorktrees.filter((meta) => {
          const directory = normalizePath(meta.path) ?? meta.path;
          return shouldRenderSidebarWorktreeGroup({
            directory,
            sessionCount: (groupedNodes.get(directory) ?? []).length,
            openedProjectPaths: args.openedProjectPaths,
          });
        });
      worktreeGroups.forEach((meta) => {
        const directory = normalizePath(meta.path) ?? meta.path;
        const currentBranch = args.gitBranches.get(directory)?.trim() || null;
        const metadataBranch = meta.branch?.trim() || null;
        const shouldSyncLabelWithBranch = Boolean(
          currentBranch && metadataBranch && meta.label && normalizeForBranchComparison(meta.label) === normalizeForBranchComparison(metadataBranch),
        );
        const label = shouldSyncLabelWithBranch
          ? currentBranch!
          : (meta.label || meta.name || formatDirectoryName(directory, args.homeDirectory) || directory);

        groups.push({
          id: `worktree:${directory}`,
          label,
          branch: currentBranch || metadataBranch,
          description: formatPathForDisplay(directory, args.homeDirectory),
          isMain: false,
          isArchivedBucket: false,
          worktree: meta,
          directory,
          folderScopeKey: directory,
          sessions: groupedNodes.get(directory) ?? [],
        });
      });

      const archivedSessions = groupedNodes.get(archivedKey) ?? [];
      if (archivedSessions.length > 0) {
        groups.push({
          id: 'archived',
          label: t('sessions.sidebar.grouping.archived'),
          branch: null,
          description: t('sessions.sidebar.grouping.archivedDescription'),
          isMain: false,
          isArchivedBucket: true,
          worktree: null,
          directory: null,
          folderScopeKey: !args.isVSCode && normalizedProjectRoot ? getArchivedScopeKey(normalizedProjectRoot) : null,
          sessions: archivedSessions,
        });
      }

      return groups;
    },
    [args.homeDirectory, args.openedProjectPaths, args.worktreeMetadata, args.pinnedSessionIds, args.sessionOrderRanks, args.gitBranches, args.isVSCode, t],
  );

  return {
    buildGroupSearchText,
    buildSessionSearchText,
    filterSessionNodesForSearch,
    buildGroupedSessions,
  };
};
