import React from 'react';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { idleLeftoverBusyAfterSettledAssistant } from '@/sync/event-reducer';
import {
  useAllLiveSessions,
  useAllSessionStatuses,
  useSessionStatus,
  useSessionMessages,
  useSessionPermissions,
  useSessionQuestions,
} from '@/sync/sync-context';
import { usePiKernel } from '@/lib/usePiKernel';
import { useFeaturePluginSlotActive } from '@/stores/useFeaturePluginSlotsStore';
import { useSubagentRuns } from '@/hooks/useSubagentRuns';
import {
  hasActiveSubagentFleet,
  openCodeChildBusy,
} from '@/lib/subagents/parentActivity';

// Mirrors OpenCode SessionStatus: busy|retry|idle.
type SessionActivityPhase = 'idle' | 'busy' | 'retry';

export interface SessionActivityResult {
  phase: SessionActivityPhase;
  isWorking: boolean;
  isBusy: boolean;
  isCooldown: boolean;
  /**
   * Parent turn settled but its Codex-owned subagent fleet is still active.
   * Keeps the parent from looking finished without arming abort/steer.
   */
  waitingForSubagents: boolean;
}

const IDLE_RESULT: SessionActivityResult = {
  phase: 'idle',
  isWorking: false,
  isBusy: false,
  isCooldown: false,
  waitingForSubagents: false,
};

export type SessionActivityMessage = {
  role?: string;
  time?: {
    created?: number;
    completed?: number;
  };
} | null | undefined;

export const isSettledAssistantMessage = (
  message: SessionActivityMessage,
): boolean => (
  Boolean(
    message
    && message.role === 'assistant'
    && typeof message.time?.completed === 'number'
    && message.time.completed > 0,
  )
);

/**
 * Determines if a session is actively working.
 * Checks session_status and, only when status is missing, falls back to the
 * trailing assistant message when its completion update has not landed yet.
 * Returns idle when permissions or questions are pending (the permission /
 * question indicator takes priority, and the send button must stay available so
 * the user can supersede the prompt with a new message).
 */
export function resolveSessionActivity(input: {
  sessionId?: string | null;
  status?: { type?: string } | null;
  lastMessage?: SessionActivityMessage;
  hasBlockingPrompt?: boolean;
  waitingForSubagents?: boolean;
}): SessionActivityResult {
  if (!input.sessionId) return IDLE_RESULT;
  if (input.hasBlockingPrompt) {
    return {
      ...IDLE_RESULT,
      waitingForSubagents: Boolean(input.waitingForSubagents),
    };
  }

  const phase: SessionActivityPhase = (input.status?.type ?? 'idle') as SessionActivityPhase;
  const lastMessage = input.lastMessage ?? null;
  const hasPendingAssistant = Boolean(
    lastMessage
    && lastMessage.role === 'assistant'
    && typeof lastMessage.time?.completed !== 'number',
  );
  const hasAuthoritativeStatus = input.status !== undefined;
  const statusWorking = hasAuthoritativeStatus && phase !== 'idle';
  // Pi finishes the assistant message before tools run. A settled trailing
  // assistant is not proof the turn is idle — trust live session.status so
  // Stop stays armed until agent_settled. Never force idle from leftover busy.
  if (
    idleLeftoverBusyAfterSettledAssistant({ status: input.status, lastMessage })
    && isSettledAssistantMessage(lastMessage)
    && !statusWorking
  ) {
    return overlayWaitingForSubagents(IDLE_RESULT, Boolean(input.waitingForSubagents));
  }

  const isWorking = statusWorking || hasPendingAssistant;

  if (hasAuthoritativeStatus && !statusWorking) {
    return overlayWaitingForSubagents(IDLE_RESULT, Boolean(input.waitingForSubagents));
  }
  if (!isWorking) {
    return overlayWaitingForSubagents(IDLE_RESULT, Boolean(input.waitingForSubagents));
  }

  return overlayWaitingForSubagents({
    phase: statusWorking ? phase : 'busy',
    isWorking: true,
    isBusy: phase === 'busy' || (!statusWorking && hasPendingAssistant),
    isCooldown: false,
    waitingForSubagents: false,
  }, Boolean(input.waitingForSubagents));
}

/** Codex: unfinished children keep the parent looking alive without faking busy. */
export const overlayWaitingForSubagents = (
  base: SessionActivityResult,
  waitingForSubagents: boolean,
): SessionActivityResult => {
  if (!waitingForSubagents) {
    return base.waitingForSubagents ? { ...base, waitingForSubagents: false } : base;
  }
  if (base.isWorking) {
    return { ...base, waitingForSubagents: true };
  }
  return {
    phase: 'idle',
    isWorking: true,
    isBusy: false,
    isCooldown: false,
    waitingForSubagents: true,
  };
};

export function useSessionActivity(sessionId: string | null | undefined, directory?: string): SessionActivityResult {
  const status = useSessionStatus(sessionId ?? '', directory);
  const messages = useSessionMessages(sessionId ?? '', directory);
  const permissions = useSessionPermissions(sessionId ?? '', directory);
  const questions = useSessionQuestions(sessionId ?? '', directory);

  return React.useMemo<SessionActivityResult>(() => (
    resolveSessionActivity({
      sessionId,
      status,
      lastMessage: messages[messages.length - 1],
      hasBlockingPrompt: permissions.length > 0 || questions.length > 0,
    })
  ), [sessionId, status, messages, permissions, questions]);
}

export function useCurrentSessionActivity(): SessionActivityResult {
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const currentSessionDirectory = useSessionUIStore((state) => state.currentSessionDirectory);
  const base = useSessionActivity(currentSessionId, currentSessionDirectory ?? undefined);
  const isPiKernel = usePiKernel();
  const subagentsSlotActive = useFeaturePluginSlotActive('subagents', isPiKernel);
  const { runs } = useSubagentRuns(
    currentSessionId,
    isPiKernel && subagentsSlotActive,
    currentSessionDirectory,
  );
  const liveSessions = useAllLiveSessions();
  const statuses = useAllSessionStatuses();

  return React.useMemo<SessionActivityResult>(() => {
    const waiting = isPiKernel
      ? hasActiveSubagentFleet(runs)
      : openCodeChildBusy(liveSessions, currentSessionId, statuses);
    return overlayWaitingForSubagents(base, waiting);
  }, [base, currentSessionId, isPiKernel, liveSessions, runs, statuses]);
}
