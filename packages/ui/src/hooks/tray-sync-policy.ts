// Tray safety-net polls exist so the menu bar can catch a missed event.
// Event subscriptions own live busy/idle. These intervals must sleep when the
// tray is off or when no session is working.

export const TRAY_STATUS_POLL_INTERVAL_MS = 5000;
export const TRAY_GLOBAL_REFRESH_MS = 45000;

export type TrayPollSession = {
  status?: string | null;
};

export const traySnapshotHasBusySession = (
  snapshot: { sessions?: TrayPollSession[] | null } | null | undefined,
): boolean => (
  (snapshot?.sessions ?? []).some((session) => (
    session?.status === 'busy' || session?.status === 'retry'
  ))
);

export const shouldRunTraySafetyPolls = (input: {
  trayEnabled: boolean;
  hasBusySession: boolean;
}): boolean => input.trayEnabled === true && input.hasBusySession === true;

export type TraySafetyPollScheduler = {
  sync: (input: { trayEnabled: boolean; hasBusySession: boolean }) => void;
  dispose: () => void;
  isPolling: () => boolean;
};

export const createTraySafetyPolls = (deps: {
  setInterval: (fn: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
  onStatusPoll: () => void;
  onGlobalRefresh: () => void;
  onSafetyFlush: () => void;
  statusIntervalMs?: number;
  globalRefreshMs?: number;
}): TraySafetyPollScheduler => {
  let statusId: number | null = null;
  let globalId: number | null = null;
  let flushId: number | null = null;

  const stop = () => {
    if (statusId !== null) {
      deps.clearInterval(statusId);
      statusId = null;
    }
    if (globalId !== null) {
      deps.clearInterval(globalId);
      globalId = null;
    }
    if (flushId !== null) {
      deps.clearInterval(flushId);
      flushId = null;
    }
  };

  const start = () => {
    if (statusId !== null) return;
    statusId = deps.setInterval(deps.onStatusPoll, deps.statusIntervalMs ?? TRAY_STATUS_POLL_INTERVAL_MS);
    globalId = deps.setInterval(deps.onGlobalRefresh, deps.globalRefreshMs ?? TRAY_GLOBAL_REFRESH_MS);
    flushId = deps.setInterval(deps.onSafetyFlush, deps.statusIntervalMs ?? TRAY_STATUS_POLL_INTERVAL_MS);
  };

  return {
    sync(input) {
      if (shouldRunTraySafetyPolls(input)) start();
      else stop();
    },
    dispose: stop,
    isPolling: () => statusId !== null,
  };
};
