import type { Session } from '@opencode-ai/sdk/v2';

const RECENT_SESSION_MAX_AGE_MS = 48 * 60 * 60 * 1000;

const isSubtaskSession = (session: Session): boolean => {
  return Boolean((session as Session & { parentID?: string | null }).parentID);
};

const isArchivedSession = (session: Session): boolean => {
  return Boolean(session.time?.archived);
};

const getSessionUpdatedAt = (session: Session): number => {
  const updated = session.time?.updated;
  const created = session.time?.created;
  if (typeof updated === 'number' && Number.isFinite(updated)) {
    return updated;
  }
  if (typeof created === 'number' && Number.isFinite(created)) {
    return created;
  }
  return 0;
};

// Recent contains non-archived root sessions that are active now or were
// updated within the retention window. The caller applies shared lifecycle
// ordering after this membership filter; batching ("Show more") handles long
// windows in the UI.
export const deriveRecentSessions = (
  sessions: Session[],
  activeSessionIds: ReadonlySet<string>,
  now = Date.now(),
): Session[] => {
  const minUpdatedAt = now - RECENT_SESSION_MAX_AGE_MS;
  return sessions.filter((session) => {
    if (isArchivedSession(session) || isSubtaskSession(session)) {
      return false;
    }
    return activeSessionIds.has(session.id) || getSessionUpdatedAt(session) >= minUpdatedAt;
  });
};

// Recent is a fallback list. Sessions already rendered in a workspace group
// (~, a project, or a worktree) stay only there so opening a chat cannot
// insert a duplicate Recent bucket or shift the sidebar under the pointer.
export const selectRecentSessionsWithoutWorkspaceGroup = (
  sessions: Session[],
  workspaceSessionIds: { readonly has: (id: string) => boolean },
): Session[] => sessions.filter((session) => !workspaceSessionIds.has(session.id));

type ActivitySectionWithItems = {
  items: ReadonlyArray<unknown>;
};

// Idle keeps the chats block even when it is empty. Search keeps the same
// block only when a chats/recent row still matches; a query alone must not
// hide hits that live only in this list.
export const shouldShowSidebarActivitySections = (args: {
  isVSCode: boolean;
  hasSessionSearchQuery: boolean;
  hasActivitySectionItems: boolean;
  activitySections: ReadonlyArray<ActivitySectionWithItems>;
}): boolean => {
  if (args.isVSCode) {
    return false;
  }
  if (args.hasSessionSearchQuery) {
    return args.activitySections.some((section) => section.items.length > 0);
  }
  return args.hasActivitySectionItems;
};

export const countSidebarSearchMatches = (
  hasSessionSearchQuery: boolean,
  projectMatchCount: number,
  activitySections: ReadonlyArray<ActivitySectionWithItems>,
): number => {
  if (!hasSessionSearchQuery) {
    return 0;
  }
  const activityMatchCount = activitySections.reduce(
    (total, section) => total + section.items.length,
    0,
  );
  return projectMatchCount + activityMatchCount;
};

