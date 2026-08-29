import type { I18nKey } from '@/lib/i18n';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { invalidateCommandsLoadCache, useCommandsStore } from '@/stores/useCommandsStore';
import { usePluginsStore } from '@/stores/usePluginsStore';
import { invalidateSkillsLoadCache, useSkillsStore } from '@/stores/useSkillsStore';

export type SessionTitleReloadBlockReason = 'busy' | 'compacting' | 'inFlight';

/**
 * Desktop session_status types are idle | busy | retry.
 * Pi TUI `/reload` also refuses while compacting. The Pi facade maps
 * `compaction_start` to `session.status { type: 'busy' }` (plus `session.compact`).
 * Global status is often missing on Pi while the composer is still outputting,
 * so callers must also pass the live activity the stop button uses.
 */
export const SESSION_TITLE_RELOAD_BLOCKING_STATUS_TYPES = ['busy', 'retry'] as const;

type ReloadSession = (sessionID: string) => Promise<unknown>;
type RefreshLists = () => Promise<unknown>;
type SessionTitleReloadFetch = (
  path: string,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'json'>>;

export function isSessionTitleReloadVisible(input: {
  isPiKernel: boolean;
  hasCurrentSession: boolean;
  isNewSessionDraftOpen: boolean;
  isRenamingSession: boolean;
}): boolean {
  return input.isPiKernel
    && input.hasCurrentSession
    && !input.isNewSessionDraftOpen
    && !input.isRenamingSession;
}

/**
 * Title-adjacent ⟳. Desktop reads this as a working spinner. Show it only
 * while reload/compaction is actually running. Idle sessions keep Reload in
 * the session overflow menu instead.
 */
export function isSessionTitleReloadGlyphVisible(input: {
  isPiKernel: boolean;
  hasCurrentSession: boolean;
  isNewSessionDraftOpen: boolean;
  isRenamingSession: boolean;
  isReloadInFlight?: boolean;
  isCompacting?: boolean;
}): boolean {
  return isSessionTitleReloadVisible(input)
    && (input.isReloadInFlight === true || input.isCompacting === true);
}

export function isSessionTitleReloadBlockedByStatus(statusType: string | null | undefined): boolean {
  return statusType === 'busy' || statusType === 'retry';
}

/**
 * Live output signal for the title refresh disable.
 *
 * ChatInput's red stop square is `useCurrentSessionActivity().phase !== 'idle'`.
 * StatusRow "Composing ..." is `useAssistantStatus().working.statusText === 'composing'`.
 * Global `session_status` is often missing on Pi while those are already true.
 */
export function isSessionTitleReloadOutputting(input: {
  sessionPhase?: string | null;
  sessionIsWorking?: boolean;
  assistantIsWorking?: boolean;
  assistantIsStreaming?: boolean;
  assistantIsForming?: boolean;
  assistantCanAbort?: boolean;
  assistantStatusText?: string | null;
}): boolean {
  return (
    (input.sessionPhase != null && input.sessionPhase !== 'idle')
    || input.sessionIsWorking === true
    || input.assistantIsWorking === true
    || input.assistantIsStreaming === true
    || input.assistantIsForming === true
    || input.assistantCanAbort === true
    || input.assistantStatusText === 'composing'
  );
}

export function isSessionTitleReloadBlocked(input: {
  statusType?: string | null;
  isOutputting?: boolean;
  isCompacting?: boolean;
}): boolean {
  return (
    isSessionTitleReloadBlockedByStatus(input.statusType)
    || input.isOutputting === true
    || input.isCompacting === true
  );
}

export function isSessionTitleReloadInFlightForSession(
  currentSessionId: string | null | undefined,
  reloadingSessionIds: ReadonlySet<string>,
): boolean {
  return Boolean(currentSessionId && reloadingSessionIds.has(currentSessionId));
}

export function getSessionTitleReloadBlockReason(input: {
  statusType?: string | null;
  isOutputting?: boolean;
  isCompacting?: boolean;
  isReloadInFlight: boolean;
}): SessionTitleReloadBlockReason | null {
  if (input.isReloadInFlight) return 'inFlight';
  if (input.isCompacting) return 'compacting';
  if (isSessionTitleReloadBlocked(input)) return 'busy';
  return null;
}

export function sessionTitleReloadAriaKey(reason: SessionTitleReloadBlockReason | null): I18nKey {
  if (reason === 'busy') return 'header.sessionReload.disabledBusy';
  if (reason === 'compacting') return 'header.sessionReload.disabledCompacting';
  if (reason === 'inFlight') return 'header.sessionReload.disabledInFlight';
  return 'header.sessionReload.aria';
}

export function sessionTitleReloadTooltipKey(reason: SessionTitleReloadBlockReason | null): I18nKey {
  if (reason === 'busy') return 'header.sessionReload.disabledBusy';
  if (reason === 'compacting') return 'header.sessionReload.disabledCompacting';
  if (reason === 'inFlight') return 'header.sessionReload.disabledInFlight';
  return 'header.sessionReload.tooltip';
}

export async function postPiSessionTitleReload(
  sessionID: string,
  fetchImpl: SessionTitleReloadFetch = runtimeFetch,
): Promise<void> {
  const response = await fetchImpl(`/api/session/${encodeURIComponent(sessionID)}/reload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.error || 'Failed to reload session');
  }
}

export async function refreshSessionTitleReloadLists(options?: {
  loadCommands?: () => Promise<unknown>;
  loadSkills?: () => Promise<unknown>;
  loadPlugins?: () => Promise<unknown>;
}): Promise<void> {
  const loadCommands = options?.loadCommands ?? (async () => {
    invalidateCommandsLoadCache();
    return useCommandsStore.getState().loadCommands();
  });
  const loadSkills = options?.loadSkills ?? (async () => {
    invalidateSkillsLoadCache();
    return useSkillsStore.getState().loadSkills();
  });
  const loadPlugins = options?.loadPlugins
    ?? (() => usePluginsStore.getState().loadPlugins({ force: true }));

  await Promise.all([loadCommands(), loadSkills(), loadPlugins()]);
}

export async function reloadPiSessionTitleConfig(options: {
  sessionID: string;
  reloadSession?: ReloadSession;
  refreshLists?: RefreshLists;
  fetchImpl?: SessionTitleReloadFetch;
}): Promise<void> {
  const reloadSession = options.reloadSession
    ?? ((sessionID) => postPiSessionTitleReload(sessionID, options.fetchImpl));
  const refreshLists = options.refreshLists ?? refreshSessionTitleReloadLists;

  await reloadSession(options.sessionID);
  await refreshLists();
}
