import type { I18nKey } from '@/lib/i18n';
import { reloadOpenCodeConfiguration } from '@/stores/useAgentsStore';
import { usePluginsStore } from '@/stores/usePluginsStore';

export type SessionTitleReloadBlockReason = 'busy' | 'inFlight';

/**
 * Desktop session_status types are idle | busy | retry.
 * Pi TUI `/reload` also refuses while compacting. The Pi facade maps
 * `compaction_start` to `session.status { type: 'busy' }` (plus `session.compact`).
 * There is no separate compacting status channel — busy already covers it.
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

export function getSessionTitleReloadBlockReason(input: {
  statusType?: string | null;
  isReloadInFlight: boolean;
}): SessionTitleReloadBlockReason | null {
  if (input.isReloadInFlight) return 'inFlight';
  if (isSessionTitleReloadBlockedByStatus(input.statusType)) return 'busy';
  return null;
}

export function sessionTitleReloadAriaKey(reason: SessionTitleReloadBlockReason | null): I18nKey {
  if (reason === 'busy') return 'header.sessionReload.disabledBusy';
  if (reason === 'inFlight') return 'header.sessionReload.disabledInFlight';
  return 'header.sessionReload.aria';
}

export function sessionTitleReloadTooltipKey(reason: SessionTitleReloadBlockReason | null): I18nKey {
  if (reason === 'busy') return 'header.sessionReload.disabledBusy';
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
