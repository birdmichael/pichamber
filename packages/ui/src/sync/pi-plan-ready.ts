import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { normalizeContextPanelDirectoryKey, useUIStore } from '@/stores/useUIStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import type { PiExtensionUiPrompt } from './pi-extension-ui';
import { isPlanReadyDecisionPrompt } from './pi-plan-locale';
import { sessionPlanHasMarkdown, type SessionPlan } from './pi-session-plan';

let openedReadySessionID: string | null = null;

export const resetPlanReadyRailOpenForTests = (): void => {
  openedReadySessionID = null;
};

export const shouldAutoOpenPlanRail = (input: {
  previous: SessionPlan | null;
  next: SessionPlan | null;
  prompt?: Pick<PiExtensionUiPrompt, 'kind' | 'status' | 'title' | 'options'> | null;
  alreadyOpenedForSession: boolean;
}): boolean => {
  if (input.alreadyOpenedForSession) return false;
  if (input.prompt && isPlanReadyDecisionPrompt(input.prompt)) return true;
  return Boolean(
    input.next
    && input.next.status === 'ready'
    && sessionPlanHasMarkdown(input.next)
    && input.previous?.status !== 'ready',
  );
};

const resolvePlanReadyDirectory = (
  sessionID: string,
  hint?: string | null,
): string => {
  const fromHint = (hint || '').trim();
  if (fromHint) return fromHint;
  const fromSession = useSessionUIStore.getState().getDirectoryForSession(sessionID);
  if (fromSession?.trim()) return fromSession.trim();
  return (useDirectoryStore.getState().currentDirectory || '').trim();
};

const openPlanReadySurface = (directory: string): void => {
  const normalized = normalizeContextPanelDirectoryKey(directory);
  if (!normalized) return;
  const ui = useUIStore.getState();
  if (ui.isMobile) {
    ui.setActiveMainTab('plan');
    return;
  }
  ui.openContextPlan(normalized);
};

export const notePlanReadyCycle = (sessionID: string, next: SessionPlan | null): void => {
  if (openedReadySessionID !== sessionID) return;
  if (!next || next.status !== 'ready') {
    openedReadySessionID = null;
  }
};

export const maybeOpenPlanRailOnReady = (input: {
  sessionID: string;
  previous: SessionPlan | null;
  next: SessionPlan | null;
  prompt?: PiExtensionUiPrompt | null;
  directoryHint?: string | null;
}): boolean => {
  const sessionID = input.sessionID.trim();
  if (!sessionID) return false;
  if (!shouldAutoOpenPlanRail({
    previous: input.previous,
    next: input.next,
    prompt: input.prompt,
    alreadyOpenedForSession: openedReadySessionID === sessionID,
  })) {
    return false;
  }
  const directory = resolvePlanReadyDirectory(
    sessionID,
    input.directoryHint ?? input.prompt?.directory,
  );
  if (!directory) return false;
  openedReadySessionID = sessionID;
  openPlanReadySurface(directory);
  return true;
};
