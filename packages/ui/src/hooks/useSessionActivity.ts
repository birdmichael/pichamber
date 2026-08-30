import React from 'react';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSessionStatus, useSessionMessages, useSessionPermissions, useSessionQuestions } from '@/sync/sync-context';

// Mirrors OpenCode SessionStatus: busy|retry|idle.
type SessionActivityPhase = 'idle' | 'busy' | 'retry';

export interface SessionActivityResult {
  phase: SessionActivityPhase;
  isWorking: boolean;
  isBusy: boolean;
  isCooldown: boolean;
}

const IDLE_RESULT: SessionActivityResult = {
  phase: 'idle',
  isWorking: false,
  isBusy: false,
  isCooldown: false,
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
}): SessionActivityResult {
  if (!input.sessionId) return IDLE_RESULT;
  if (input.hasBlockingPrompt) return IDLE_RESULT;

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
  // busy Enter can still steer / followUp.
  if (isSettledAssistantMessage(lastMessage) && !statusWorking) return IDLE_RESULT;

  const isWorking = statusWorking || hasPendingAssistant;

  if (hasAuthoritativeStatus && !statusWorking) return IDLE_RESULT;
  if (!isWorking) return IDLE_RESULT;

  return {
    phase: statusWorking ? phase : 'busy',
    isWorking: true,
    isBusy: phase === 'busy' || (!statusWorking && hasPendingAssistant),
    isCooldown: false,
  };
}

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
  return useSessionActivity(currentSessionId, currentSessionDirectory ?? undefined);
}
