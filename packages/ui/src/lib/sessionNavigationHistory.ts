import { useSessionUIStore } from '@/sync/session-ui-store';
import { useGlobalSessionsStore, resolveGlobalSessionDirectory } from '@/stores/useGlobalSessionsStore';
import { getRuntimeKey } from '@/lib/runtime-switch';

// Browser-style back/forward over the order sessions were opened in this
// window. A normal session switch truncates the forward part and appends;
// stepping through history moves only the cursor, so back stays back even
// after several presses. In-memory by design: the stack describes this
// window's journey, not durable state.

const MAX_HISTORY = 100;

let visitedSessionIds: string[] = [];
let cursor = -1;
let navigating = false;
// After a history step, store/URL reconciliation can re-apply the restored
// session (or briefly bounce through the previous id) once `navigating` is
// cleared. Those follow-ups must not `recordVisit` or they truncate forward —
// the same failure mode as a fresh sidebar click after Back (#658).
let suppressVisitRecording = false;
let suppressEpoch = 0;
let boundRuntimeKey = getRuntimeKey();

const resetStack = (): void => {
  visitedSessionIds = [];
  cursor = -1;
};

const ensureRuntimeStack = (): void => {
  const key = getRuntimeKey();
  if (key === boundRuntimeKey) return;
  boundRuntimeKey = key;
  resetStack();
};

const recordVisit = (sessionId: string): void => {
  ensureRuntimeStack();
  if (visitedSessionIds[cursor] === sessionId) return;
  visitedSessionIds = [...visitedSessionIds.slice(0, cursor + 1), sessionId].slice(-MAX_HISTORY);
  cursor = visitedSessionIds.length - 1;
};

const beginHistoryNavigation = (): number => {
  navigating = true;
  suppressVisitRecording = true;
  return ++suppressEpoch;
};

const endHistoryNavigation = (epoch: number): void => {
  navigating = false;
  // Clear after the current turn + a macrotask so React effects and URL sync
  // that re-apply the landed session cannot truncate the forward branch.
  queueMicrotask(() => {
    setTimeout(() => {
      if (epoch !== suppressEpoch) return;
      suppressVisitRecording = false;
    }, 0);
  });
};

useSessionUIStore.subscribe((state, previousState) => {
  if (state.currentSessionId === previousState.currentSessionId) return;
  if (!state.currentSessionId || navigating || suppressVisitRecording) return;
  recordVisit(state.currentSessionId);
});

const applyHistorySession = (sessionId: string, directory: string | null | undefined): void => {
  const epoch = beginHistoryNavigation();
  try {
    useSessionUIStore.getState().setCurrentSession(sessionId, directory);
  } finally {
    endHistoryNavigation(epoch);
  }
};

/**
 * True while a session-history back/forward is applying, including the short
 * settle window that absorbs store/URL sync follow-ups. URL sync should
 * replaceState (not pushState) during this window.
 */
export const isSessionHistoryNavigationPending = (): boolean =>
  navigating || suppressVisitRecording;

/**
 * Steps the current session back (-1) or forward (+1) through this window's
 * open history. Entries whose session no longer exists in the loaded list are
 * skipped and dropped. Returns false when there is nowhere to go.
 */
export const navigateSessionHistory = (delta: -1 | 1): boolean => {
  ensureRuntimeStack();
  const globalSessions = useGlobalSessionsStore.getState();
  // A failed or in-flight list is not proof the sessions are gone.
  if (!globalSessions.hasLoaded || globalSessions.status !== 'ready') return false;
  const sessionsById = new Map(
    [...globalSessions.activeSessions, ...globalSessions.archivedSessions]
      .map((session) => [session.id, session] as const),
  );
  const currentId = useSessionUIStore.getState().currentSessionId;
  const cursorId = cursor >= 0 ? visitedSessionIds[cursor] : undefined;
  // A new-session draft (or any current id that is not the cursor) sits off
  // the stack. Back restores the cursor entry instead of stepping past it.
  if (delta < 0 && currentId !== cursorId && cursorId) {
    const session = sessionsById.get(cursorId);
    if (session) {
      applyHistorySession(session.id, resolveGlobalSessionDirectory(session));
      return true;
    }
  }
  let nextCursor = cursor + delta;
  while (nextCursor >= 0 && nextCursor < visitedSessionIds.length) {
    const session = sessionsById.get(visitedSessionIds[nextCursor]);
    if (session) {
      cursor = nextCursor;
      applyHistorySession(session.id, resolveGlobalSessionDirectory(session));
      return true;
    }
    // Drop the dead entry at nextCursor and keep scanning in the same
    // direction: a removal shifts later entries one index down, so the next
    // forward candidate lands on the same index while a backward scan steps.
    visitedSessionIds = [
      ...visitedSessionIds.slice(0, nextCursor),
      ...visitedSessionIds.slice(nextCursor + 1),
    ];
    if (nextCursor < cursor) cursor -= 1;
    if (delta < 0) nextCursor -= 1;
  }
  return false;
};

export const resetSessionNavigationHistoryForTests = (): void => {
  resetStack();
  navigating = false;
  suppressVisitRecording = false;
  suppressEpoch += 1;
  boundRuntimeKey = getRuntimeKey();
};

/** Wait until the post-navigation recordVisit suppress window has cleared. */
export const flushSessionNavigationHistorySuppressForTests = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

export const getSessionNavigationHistorySnapshotForTests = (): {
  visitedSessionIds: string[];
  cursor: number;
  suppressVisitRecording: boolean;
} => ({
  visitedSessionIds: [...visitedSessionIds],
  cursor,
  suppressVisitRecording,
});
