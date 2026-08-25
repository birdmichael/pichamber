/**
 * Archive, Scheduled Tasks, and Worktrees share one dismiss path:
 * `useUIStore.closeMainSurfaces`. Nested pickers/dialogs must win first
 * (same layering as Settings). Multi-run launcher and compare already own
 * Cancel/Esc and must not be closed here.
 */

export type MainSurfaceDismissState = {
  isArchivePageOpen: boolean;
  isScheduledTasksDialogOpen: boolean;
  worktreesPageProjectId: string | null;
  isMultiRunLauncherOpen: boolean;
  multiRunCompareGroup: unknown;
};

export function isSharedEscMainSurface(state: MainSurfaceDismissState): boolean {
  if (state.isMultiRunLauncherOpen || Boolean(state.multiRunCompareGroup)) {
    return false;
  }
  return Boolean(
    state.isArchivePageOpen
    || state.isScheduledTasksDialogOpen
    || state.worktreesPageProjectId,
  );
}

/** First Esc closes an open picker/dialog; otherwise Esc closes the page. */
export function shouldCloseMainSurfaceOnEscape(
  state: MainSurfaceDismissState,
  blocked = false,
): boolean {
  if (blocked) return false;
  return isSharedEscMainSurface(state);
}
