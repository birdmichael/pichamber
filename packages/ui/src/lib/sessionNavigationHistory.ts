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

useSessionUIStore.subscribe((state, previousState) => {
  if (state.currentSessionId === previousState.currentSessionId) return;
  if (!state.currentSessionId || navigating) return;
  recordVisit(state.currentSessionId);
});

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
      navigating = true;
      try {
        useSessionUIStore.getState().setCurrentSession(session.id, resolveGlobalSessionDirectory(session));
      } finally {
        navigating = false;
      }
      return true;
    }
  }
  let nextCursor = cursor + delta;
  while (nextCursor >= 0 && nextCursor < visitedSessionIds.length) {
    const session = sessionsById.get(visitedSessionIds[nextCursor]);
    if (session) {
      cursor = nextCursor;
      navigating = true;
      try {
        useSessionUIStore.getState().setCurrentSession(session.id, resolveGlobalSessionDirectory(session));
      } finally {
        navigating = false;
      }
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
  boundRuntimeKey = getRuntimeKey();
};
