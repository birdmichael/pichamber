import React from 'react';
import { getMessageQueueKey, parseMessageQueueKey, useMessageQueueStore, type MessageQueueTarget, type QueuedMessage } from '@/stores/messageQueueStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSelectionStore } from '@/sync/selection-store';
import { useConfigStore } from '@/stores/useConfigStore';
import { useContextStore } from '@/stores/contextStore';
import { useAutoReviewStore } from '@/stores/useAutoReviewStore';
import { parseAgentMentions } from '@/lib/messages/agentMentions';
import { contextPayloadFromDraft, createContextPart } from '@/lib/messages/contextParts';
import { usePiKernel } from '@/lib/usePiKernel';
import { getDirectoryState } from '@/sync/sync-refs';
import { useDirectorySync } from '@/sync/sync-context';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { useGlobalSessionStatusStore } from '@/sync/global-session-status';

type SessionStatusType = 'idle' | 'busy' | 'retry';

const RECENT_ABORT_WINDOW_MS = 2000;

const AUTO_SEND_RETRY_BASE_DELAY_MS = 2000;
const AUTO_SEND_RETRY_MAX_DELAY_MS = 60000;

export type QueuedAutoSendFailure = {
  messageId: string;
  failures: number;
  nextAttemptAt: number;
};

export const getQueuedAutoSendRetryDelayMs = (failures: number): number =>
  Math.min(AUTO_SEND_RETRY_BASE_DELAY_MS * 2 ** Math.max(failures - 1, 0), AUTO_SEND_RETRY_MAX_DELAY_MS);

export const isQueuedAutoSendBackedOff = (
  failure: QueuedAutoSendFailure | undefined,
  messageId: string,
  now: number,
): boolean => failure !== undefined && failure.messageId === messageId && now < failure.nextAttemptAt;

export const createQueuedAutoSendRetryScheduler = (
  onWake: () => void,
  now: () => number = Date.now,
  scheduleTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancelTimeout: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let scheduledAt: number | null = null;

  return {
    schedule(retryAt: number) {
      if (scheduledAt !== null && scheduledAt <= retryAt) return;
      if (timer !== null) cancelTimeout(timer);
      scheduledAt = retryAt;
      timer = scheduleTimeout(() => {
        timer = null;
        scheduledAt = null;
        onWake();
      }, Math.max(0, retryAt - now()));
    },
    dispose() {
      if (timer !== null) cancelTimeout(timer);
      timer = null;
      scheduledAt = null;
    },
  };
};

/**
 * When the abort window is still open, returns the time it expires so the
 * caller can wake the queue then. Returns `null` once sending is allowed
 * again — a queued item must not wait for an unrelated state change to be
 * retried after the window closes.
 */
const getAbortHoldUntil = (sessionId: string): number | null => {
  const abortRecord = useSessionUIStore.getState().sessionAbortFlags.get(sessionId);
  if (!abortRecord) {
    return null;
  }
  const holdUntil = abortRecord.timestamp + RECENT_ABORT_WINDOW_MS;
  return Date.now() < holdUntil ? holdUntil : null;
};

export const buildQueuedAutoSendPayload = (
  queue: QueuedMessage[],
  options: { isPiKernel?: boolean } = {},
) => {
  const queued = queue[0];
  if (!queued) {
    return null;
  }

  const agents = useConfigStore.getState().getVisibleAgents();
  const { sanitizedText, mention } = parseAgentMentions(queued.content, agents, {
    isPiKernel: options.isPiKernel,
  });

  const additionalParts = (queued.contextDrafts ?? []).map((draft) => (
    createContextPart(contextPayloadFromDraft(draft))
  ));

  return {
    queuedMessageId: queued.id,
    primaryText: sanitizedText,
    primaryAttachments: queued.attachments ?? [],
    additionalParts: additionalParts.length > 0 ? additionalParts : undefined,
    agentMentionName: mention?.name,
    sendConfig: queued.sendConfig,
  };
};

type QueuedAutoSendPayload = NonNullable<ReturnType<typeof buildQueuedAutoSendPayload>>;
type ResolvedQueuedSendConfig = {
  providerID: string;
  modelID: string;
  agent?: string;
  variant?: string;
};

export const sendQueuedAutoSendPayload = (
  target: MessageQueueTarget,
  payload: QueuedAutoSendPayload,
  resolved: ResolvedQueuedSendConfig,
) => {
  return useSessionUIStore.getState().sendMessage(
    payload.primaryText,
    resolved.providerID,
    resolved.modelID,
    resolved.agent,
    payload.primaryAttachments,
    payload.agentMentionName,
    payload.additionalParts,
    resolved.variant,
    'normal',
    { target },
  );
};

const resolveSessionSendConfig = (sessionId: string) => {
  const context = useContextStore.getState();
  const config = useConfigStore.getState();
  const selection = useSelectionStore.getState();

  const selectedAgent =
    context.getSessionAgentSelection(sessionId)
    ?? context.getCurrentAgent(sessionId)
    ?? config.currentAgentName
    ?? undefined;

  const sessionModel = context.getSessionModelSelection(sessionId);
  const agentModel = selectedAgent
    ? context.getAgentModelForSession(sessionId, selectedAgent)
    : null;

  const providerID =
    agentModel?.providerId
    ?? sessionModel?.providerId
    ?? config.currentProviderId
    ?? selection.lastUsedProvider?.providerID;
  const modelID =
    agentModel?.modelId
    ?? sessionModel?.modelId
    ?? config.currentModelId
    ?? selection.lastUsedProvider?.modelID;

  const variant =
    selectedAgent && providerID && modelID
      ? (selection.getAgentModelVariantForSession(sessionId, selectedAgent, providerID, modelID)
        ?? context.getAgentModelVariantForSession(sessionId, selectedAgent, providerID, modelID))
      : undefined;

  return {
    providerID,
    modelID,
    agent: selectedAgent,
    variant,
  };
};

export const shouldDispatchQueuedAutoSend = (
  previousStatusType: SessionStatusType | undefined,
  currentStatusType: SessionStatusType,
  hasQueuedItems: boolean = false,
): boolean => {
  if (hasQueuedItems && currentStatusType === 'idle') return true;
  return (previousStatusType === 'busy' || previousStatusType === 'retry')
    && currentStatusType === 'idle';
};

/**
 * Resolve the live status the queue gate should honor for a session.
 *
 * `/session/status` omits idle sessions. A missed busy event leaves no entry
 * while a turn is still streaming. Use the latest assistant (Steer can append
 * a user bubble after it) so the queue does not dispatch into that turn.
 */
export const resolveQueuedSessionStatusType = (
  sessionId: string,
  directory: string,
): SessionStatusType => {
  const state = getDirectoryState(directory);
  const statusType = state?.session_status?.[sessionId]?.type;
  if (statusType === 'busy' || statusType === 'retry') {
    return statusType;
  }
  const globalType = useGlobalSessionStatusStore.getState().statusById.get(sessionId)?.status?.type;
  if (globalType === 'busy' || globalType === 'retry') {
    return globalType;
  }
  const sessionMessages = state?.message?.[sessionId];
  if (sessionMessages) {
    for (let index = sessionMessages.length - 1; index >= 0; index -= 1) {
      const message = sessionMessages[index];
      if (message?.role !== 'assistant') continue;
      if (typeof (message as { time?: { completed?: number } }).time?.completed !== 'number') {
        return 'busy';
      }
      break;
    }
  }
  return 'idle';
};

export function useQueuedMessageAutoSend(enabledOrOptions?: boolean | { enabled?: boolean }) {
  const enabled = typeof enabledOrOptions === 'boolean' ? enabledOrOptions : (enabledOrOptions?.enabled ?? true);
  const isPiKernel = usePiKernel();
  const queuedMessages = useMessageQueueStore((state) => state.queuedMessages);
  const autoReviewRuns = useAutoReviewStore((state) => state.runsByOriginalSessionID);
  const sessionStatusRecord = useDirectorySync((state) => state.session_status);
  // Message completion clears the in-flight fallback in
  // resolveQueuedSessionStatusType; subscribe so the queue drains the moment
  // the trailing assistant message completes even if status events were missed.
  const sessionMessages = useDirectorySync((state) => state.message);
  // Queues are keyed by the session's own directory. Subscribe to the global
  // busy/retry index so a queue in a background project still drains when
  // that session settles — not only the currently selected DirectoryStore.
  const globalSessionStatus = useGlobalSessionStatusStore((state) => state.statusById);

  const inFlightSessionsRef = React.useRef<Set<string>>(new Set());
  const sendFailuresRef = React.useRef<Map<string, QueuedAutoSendFailure>>(new Map());
  const previousStatusRef = React.useRef<Map<string, SessionStatusType>>(new Map());
  const autoReviewBlockedSessionsRef = React.useRef<Set<string>>(new Set());
  const [retryTick, setRetryTick] = React.useState(0);
  const retryScheduler = React.useMemo(
    () => createQueuedAutoSendRetryScheduler(() => setRetryTick((value) => value + 1)),
    [],
  );

  React.useEffect(() => () => retryScheduler.dispose(), [retryScheduler]);

  React.useEffect(() => {
    if (!enabled) {
      return;
    }

    const dispatchSessionQueue = async (target: MessageQueueTarget, queueSnapshot: QueuedMessage[]) => {
      const { sessionId } = target;
      const targetKey = getMessageQueueKey(target);
      if (queueSnapshot.length === 0) {
        return;
      }
      if (inFlightSessionsRef.current.has(targetKey)) {
        return;
      }
      const abortHoldUntil = getAbortHoldUntil(sessionId);
      if (abortHoldUntil !== null) {
        retryScheduler.schedule(abortHoldUntil);
        return;
      }
      if (useAutoReviewStore.getState().isRunningForSession(sessionId)) {
        autoReviewBlockedSessionsRef.current.add(sessionId);
        return;
      }

      const currentStatus = resolveQueuedSessionStatusType(sessionId, target.directory);
      if (currentStatus !== 'idle') {
        return;
      }

      // Read the queue back at dispatch time and skip anything already being
      // delivered, rather than trusting the render-time snapshot.
      const payload = buildQueuedAutoSendPayload(
        useMessageQueueStore.getState().getSendableQueue(target),
        { isPiKernel },
      );
      if (!payload) {
        return;
      }

      const failure = sendFailuresRef.current.get(targetKey);
      if (failure && failure.messageId !== payload.queuedMessageId) {
        sendFailuresRef.current.delete(targetKey);
      } else if (failure && isQueuedAutoSendBackedOff(failure, payload.queuedMessageId, Date.now())) {
        retryScheduler.schedule(failure.nextAttemptAt);
        return;
      }

      // Use send config captured at queue time; fall back to current config
      const captured = payload.sendConfig;
      const resolved = captured?.providerID && captured?.modelID
        ? captured
        : resolveSessionSendConfig(sessionId);
      if (!resolved.providerID || !resolved.modelID) {
        // Legacy queues may predate captured send configuration. Config
        // hydration is asynchronous, so retry instead of stranding the item
        // until an unrelated status or directory update happens.
        retryScheduler.schedule(Date.now() + AUTO_SEND_RETRY_BASE_DELAY_MS);
        return;
      }

      inFlightSessionsRef.current.add(targetKey);
      // The ref only guards this hook. Publish the dispatch to the store so the
      // composer cannot merge the same item into a parallel send while this one
      // is still awaiting the server.
      useMessageQueueStore.getState().markSending(target, payload.queuedMessageId);

      try {
        await sendQueuedAutoSendPayload(target, payload, {
          providerID: resolved.providerID,
          modelID: resolved.modelID,
          agent: resolved.agent,
          variant: resolved.variant,
        });
        useMessageQueueStore.getState().removeFromQueue(target, payload.queuedMessageId);
        sendFailuresRef.current.delete(targetKey);
      } catch (error) {
        console.warn('[queue] queued auto-send failed:', error);
        const priorFailures = failure?.messageId === payload.queuedMessageId ? failure.failures : 0;
        const failures = priorFailures + 1;
        const nextAttemptAt = Date.now() + getQueuedAutoSendRetryDelayMs(failures);
        sendFailuresRef.current.set(targetKey, {
          messageId: payload.queuedMessageId,
          failures,
          nextAttemptAt,
        });
        retryScheduler.schedule(nextAttemptAt);
      } finally {
        inFlightSessionsRef.current.delete(targetKey);
        useMessageQueueStore.getState().clearSending(target, payload.queuedMessageId);
      }
    };

    const statusRecord = sessionStatusRecord ?? {};
    const nextStatusMap = new Map(previousStatusRef.current);
    for (const [sessionId, status] of Object.entries(statusRecord)) {
      if (status) {
        nextStatusMap.set(sessionId, status.type as SessionStatusType);
      }
    }
    for (const [sessionId, entry] of globalSessionStatus) {
      if (entry?.status?.type === 'busy' || entry?.status?.type === 'retry') {
        nextStatusMap.set(sessionId, entry.status.type);
      }
    }

    const queueEntries = Object.entries(queuedMessages);
    queueEntries.forEach(([key, queue]) => {
      const target = parseMessageQueueKey(key);
      if (!target || target.runtimeKey !== getRuntimeKey()) return;
      const { sessionId } = target;
      const currentStatusType = resolveQueuedSessionStatusType(sessionId, target.directory);
      const previousStatusType = previousStatusRef.current.get(sessionId);
      const wasAutoReviewBlocked = autoReviewBlockedSessionsRef.current.has(sessionId);
      const isAutoReviewRunning = useAutoReviewStore.getState().isRunningForSession(sessionId);
      if (isAutoReviewRunning) {
        autoReviewBlockedSessionsRef.current.add(sessionId);
      } else if (wasAutoReviewBlocked) {
        autoReviewBlockedSessionsRef.current.delete(sessionId);
      }

      if (queue.length > 0 && (
        shouldDispatchQueuedAutoSend(previousStatusType, currentStatusType, queue.length > 0)
        || (wasAutoReviewBlocked && !isAutoReviewRunning && currentStatusType === 'idle')
      )) {
        void dispatchSessionQueue(target, queue);
      }

      nextStatusMap.set(sessionId, currentStatusType);
    });

    previousStatusRef.current = nextStatusMap;
  }, [enabled, isPiKernel, queuedMessages, sessionStatusRecord, sessionMessages, globalSessionStatus, autoReviewRuns, retryTick, retryScheduler]);
}
