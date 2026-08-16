import { runtimeFetch } from '@/lib/runtime-fetch';
import type { I18nKey } from '@/lib/i18n';

export type SessionTitleReloadBlockReason = 'busy' | 'inFlight';

type ConfigReloadFetch = (
  path: string,
  init?: { method?: string },
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

export function getSessionTitleReloadBlockReason(input: {
  isCurrentSessionActive: boolean;
  isReloadInFlight: boolean;
}): SessionTitleReloadBlockReason | null {
  if (input.isReloadInFlight) return 'inFlight';
  if (input.isCurrentSessionActive) return 'busy';
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

const readReloadErrorMessage = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if ('error' in payload && typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error;
  }
  if ('message' in payload && typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message;
  }
  return null;
};

export async function requestPiConfigReload(options?: {
  fetchImpl?: ConfigReloadFetch;
}): Promise<void> {
  const fetchImpl = options?.fetchImpl ?? runtimeFetch;
  const response = await fetchImpl('/api/config/reload', { method: 'POST' });
  if (response.ok) return;

  const payload: unknown = await response.json().catch(() => null);
  throw new Error(readReloadErrorMessage(payload) ?? '');
}
