import type { I18nKey } from '@/lib/i18n';
import { reloadOpenCodeConfiguration } from '@/stores/useAgentsStore';
import { usePluginsStore } from '@/stores/usePluginsStore';

export type SessionTitleReloadBlockReason = 'busy' | 'compacting' | 'inFlight';

/**
 * Desktop session_status types are idle | busy | retry.
 * Pi TUI `/reload` also refuses while compacting. The Pi facade maps
 * `compaction_start` to `session.status { type: 'busy' }` (plus `session.compact`).
 * Global status is often missing on Pi while the composer is still outputting,
 * so callers must also pass the live activity the stop button uses.
 */
export const SESSION_TITLE_RELOAD_BLOCKING_STATUS_TYPES = ['busy', 'retry'] as const;

type ReloadConfiguration = typeof reloadOpenCodeConfiguration;
type RefreshExtensions = () => Promise<unknown>;

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

export async function reloadPiSessionTitleConfig(options?: {
  message?: string;
  reloadConfiguration?: ReloadConfiguration;
  refreshExtensions?: RefreshExtensions;
}): Promise<void> {
  const reloadConfiguration = options?.reloadConfiguration ?? reloadOpenCodeConfiguration;
  const refreshExtensions = options?.refreshExtensions
    ?? (() => usePluginsStore.getState().loadPlugins({ force: true }));

  await reloadConfiguration({
    message: options?.message,
    scopes: ['all'],
    mode: 'projects',
  });
  await refreshExtensions();
}
