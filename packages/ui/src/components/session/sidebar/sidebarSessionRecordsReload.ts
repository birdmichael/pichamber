import type { I18nKey } from '@/lib/i18n';
import { runtimeFetch } from '@/lib/runtime-fetch';
import {
  getSessionTitleReloadBlockReason,
  isSessionTitleReloadBlocked,
  isSessionTitleReloadInFlightForSession,
  isSessionTitleReloadOutputting,
  refreshSessionTitleReloadLists,
  type SessionTitleReloadBlockReason,
} from '@/components/layout/headerSessionReload';

export type SessionRecordsReloadBlockReason = SessionTitleReloadBlockReason;

type SessionRecordsReloadFetch = (
  path: string,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'json'>>;

export type PiSessionRecordsReloadResult = {
  reloaded: true;
  kernel: 'pi';
  sessionID?: string;
  sessions?: Array<{ id?: string }>;
  messages?: unknown[];
};

export function isSidebarSessionRecordsReloadVisible(input: {
  isPiKernel: boolean;
}): boolean {
  return input.isPiKernel;
}

export function getSessionRecordsReloadBlockReason(input: {
  hasTargetedSession: boolean;
  statusType?: string | null;
  isOutputting?: boolean;
  isCompacting?: boolean;
  isReloadInFlight: boolean;
}): SessionRecordsReloadBlockReason | null {
  if (input.isReloadInFlight) return 'inFlight';
  if (!input.hasTargetedSession) return null;
  return getSessionTitleReloadBlockReason({
    statusType: input.statusType,
    isOutputting: input.isOutputting,
    isCompacting: input.isCompacting,
    isReloadInFlight: false,
  });
}

export function sessionRecordsReloadAriaKey(reason: SessionRecordsReloadBlockReason | null): I18nKey {
  if (reason === 'busy') return 'sessions.sidebar.footer.refresh.disabledBusy';
  if (reason === 'compacting') return 'sessions.sidebar.footer.refresh.disabledCompacting';
  if (reason === 'inFlight') return 'sessions.sidebar.footer.refresh.disabledInFlight';
  return 'sessions.sidebar.footer.refresh.aria';
}

export function sessionRecordsReloadTooltipKey(reason: SessionRecordsReloadBlockReason | null): I18nKey {
  if (reason === 'busy') return 'sessions.sidebar.footer.refresh.disabledBusy';
  if (reason === 'compacting') return 'sessions.sidebar.footer.refresh.disabledCompacting';
  if (reason === 'inFlight') return 'sessions.sidebar.footer.refresh.disabledInFlight';
  return 'sessions.sidebar.footer.refresh.tooltip';
}

export async function postPiSessionRecordsReload(
  sessionID: string | null | undefined,
  fetchImpl: SessionRecordsReloadFetch = runtimeFetch,
): Promise<PiSessionRecordsReloadResult> {
  const response = await fetchImpl('/api/pi/sessions/reload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sessionID ? { sessionID } : {}),
  });
  const payload = await response.json().catch(() => null) as (
    PiSessionRecordsReloadResult & { error?: string }
  ) | null;
  if (!response.ok) {
    throw new Error(payload?.error || 'Failed to reload sessions');
  }
  return payload ?? { reloaded: true, kernel: 'pi' };
}

export async function applyPiSessionRecordsRefresh(options: {
  directory?: string | null;
  sessionID?: string | null;
  requestBootstrap?: (demand: {
    directory: string;
    priority: 'selected';
    reason: 'action-demand';
    force: true;
  }) => void;
  refreshGlobalSessions?: () => Promise<unknown>;
  refreshMessages?: (target: { directory: string; sessionID: string }) => Promise<unknown>;
  refreshLists?: () => Promise<unknown>;
}): Promise<void> {
  const directory = typeof options.directory === 'string' ? options.directory.trim() : '';
  const sessionID = typeof options.sessionID === 'string' ? options.sessionID.trim() : '';
  if (directory) {
    options.requestBootstrap?.({
      directory,
      priority: 'selected',
      reason: 'action-demand',
      force: true,
    });
  }
  const tasks: Array<Promise<unknown>> = [];
  if (options.refreshGlobalSessions) {
    tasks.push(Promise.resolve(options.refreshGlobalSessions()));
  }
  if (directory && sessionID && options.refreshMessages) {
    tasks.push(Promise.resolve(options.refreshMessages({ directory, sessionID })));
  }
  if (options.refreshLists) {
    tasks.push(Promise.resolve(options.refreshLists()));
  }
  await Promise.all(tasks);
}

export async function reloadPiSessionRecords(options: {
  sessionID?: string | null;
  directory?: string | null;
  fetchImpl?: SessionRecordsReloadFetch;
  applyRefresh?: typeof applyPiSessionRecordsRefresh;
  refreshLists?: () => Promise<unknown>;
  requestBootstrap?: Parameters<typeof applyPiSessionRecordsRefresh>[0]['requestBootstrap'];
  refreshGlobalSessions?: () => Promise<unknown>;
  refreshMessages?: (target: { directory: string; sessionID: string }) => Promise<unknown>;
}): Promise<PiSessionRecordsReloadResult> {
  const result = await postPiSessionRecordsReload(options.sessionID, options.fetchImpl);
  const applyRefresh = options.applyRefresh ?? applyPiSessionRecordsRefresh;
  await applyRefresh({
    directory: options.directory,
    sessionID: options.sessionID,
    requestBootstrap: options.requestBootstrap,
    refreshGlobalSessions: options.refreshGlobalSessions,
    refreshMessages: options.refreshMessages,
    refreshLists: options.refreshLists ?? refreshSessionTitleReloadLists,
  });
  return result;
}

export {
  isSessionTitleReloadBlocked,
  isSessionTitleReloadInFlightForSession,
  isSessionTitleReloadOutputting,
};
