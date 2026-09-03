import { create } from 'zustand';

import { maybeOpenPlanRailOnReady, notePlanReadyCycle } from './pi-plan-ready';
import { isPlanReadyDecisionPrompt, isPlanReadyImplementHereOption, planReadyOptionForAction } from './pi-plan-locale';
import { replyPiExtensionUi } from './pi-extension-ui';
import { usePiExtensionUiStore } from './pi-extension-ui-store';
import {
  fetchSessionPlan,
  isFooterPlanSelected,
  parseSessionPlan,
  runSessionPlanAction,
  type SessionPlan,
  type SessionPlanAction,
} from './pi-session-plan';

type PiSessionPlanState = {
  plansBySession: Record<string, SessionPlan>;
  pendingDraftPlanBySession: Record<string, true>;
  implementedBySession: Record<string, true>;
};

const empty: PiSessionPlanState = {
  plansBySession: {},
  pendingDraftPlanBySession: {},
  implementedBySession: {},
};

export const usePiSessionPlanStore = create<PiSessionPlanState>(() => empty);

const planRevisionBySession: Record<string, number> = {};

const bumpPlanRevision = (sessionID: string): number => {
  const next = (planRevisionBySession[sessionID] ?? 0) + 1;
  planRevisionBySession[sessionID] = next;
  return next;
};

export const resetPiSessionPlanStore = (): void => {
  usePiSessionPlanStore.setState(empty);
  for (const key of Object.keys(planRevisionBySession)) delete planRevisionBySession[key];
};

export const markPendingDraftPlan = (sessionID: string): void => {
  const id = sessionID.trim();
  if (!id) return;
  usePiSessionPlanStore.setState((state) => ({
    pendingDraftPlanBySession: {
      ...state.pendingDraftPlanBySession,
      [id]: true,
    },
  }));
};

export const clearPendingDraftPlan = (sessionID: string): void => {
  const id = sessionID.trim();
  if (!id) return;
  usePiSessionPlanStore.setState((state) => {
    if (!state.pendingDraftPlanBySession[id]) return state;
    const pendingDraftPlanBySession = { ...state.pendingDraftPlanBySession };
    delete pendingDraftPlanBySession[id];
    return { pendingDraftPlanBySession };
  });
};

export const markPlanImplemented = (sessionID: string): void => {
  const id = sessionID.trim();
  if (!id) return;
  usePiSessionPlanStore.setState((state) => ({
    implementedBySession: {
      ...state.implementedBySession,
      [id]: true,
    },
  }));
};

export const clearPlanImplemented = (sessionID: string): void => {
  const id = sessionID.trim();
  if (!id) return;
  usePiSessionPlanStore.setState((state) => {
    if (!state.implementedBySession[id]) return state;
    const implementedBySession = { ...state.implementedBySession };
    delete implementedBySession[id];
    return { implementedBySession };
  });
};

export const isPlanImplemented = (sessionID?: string | null): boolean => {
  const id = typeof sessionID === 'string' ? sessionID.trim() : '';
  if (!id) return false;
  return usePiSessionPlanStore.getState().implementedBySession[id] === true;
};

export const isPendingDraftPlan = (sessionID?: string | null): boolean => {
  const id = typeof sessionID === 'string' ? sessionID.trim() : '';
  if (!id) return false;
  return usePiSessionPlanStore.getState().pendingDraftPlanBySession[id] === true;
};

/** Transfer draft Plan onto the new session before createSession closes the draft. */
export const adoptDraftPlanForSession = (sessionID: string): void => {
  const id = sessionID.trim();
  if (!id) return;
  markPendingDraftPlan(id);
  applySessionPlan(id, { status: 'active', planMarkdown: '' });
};

const shouldKeepPlanAgainstOff = (sessionID: string, incoming: SessionPlan | null): boolean => {
  if (incoming?.status !== 'off') return false;
  if (isPendingDraftPlan(sessionID)) return true;
  const current = usePiSessionPlanStore.getState().plansBySession[sessionID];
  // User-initiated implement: GET off is not "don't clobber Plan". Keep
  // optimistic implementing; never preserve ready/active after implement.
  if (isPlanImplemented(sessionID) || current?.status === 'implementing') {
    return current?.status === 'implementing';
  }
  return Boolean(current && isFooterPlanSelected(current.status));
};

const shouldIgnoreIncomingReady = (sessionID: string, incoming: SessionPlan | null): boolean => {
  if (incoming?.status !== 'ready') return false;
  const current = usePiSessionPlanStore.getState().plansBySession[sessionID];
  return current?.status === 'implementing' || isPlanImplemented(sessionID);
};

const shouldIgnoreIncomingImplementing = (sessionID: string, incoming: SessionPlan | null): boolean => {
  if (incoming?.status !== 'implementing') return false;
  if (!isPlanImplemented(sessionID)) return false;
  const current = usePiSessionPlanStore.getState().plansBySession[sessionID];
  // After agent_settled flipped implementing → off, leftover adapter
  // activeImplementation must not resurrect building… chrome.
  return current?.status !== 'implementing';
};

const shouldSkipIncomingPlan = (sessionID: string, incoming: SessionPlan | null): boolean => (
  shouldKeepPlanAgainstOff(sessionID, incoming)
  || shouldIgnoreIncomingReady(sessionID, incoming)
  || shouldIgnoreIncomingImplementing(sessionID, incoming)
);

/**
 * agent_settled / session.idle: leftover implementing is not a live turn.
 * Keep `implemented` so a stale GET ready cannot restore Build.
 */
export const settleSessionPlanImplementing = (sessionID: string): void => {
  const id = sessionID.trim();
  if (!id) return;
  const current = usePiSessionPlanStore.getState().plansBySession[id];
  if (current?.status !== 'implementing') return;
  bumpPlanRevision(id);
  const next: SessionPlan = { status: 'off', planMarkdown: '' };
  usePiSessionPlanStore.setState((state) => ({
    plansBySession: {
      ...state.plansBySession,
      [id]: next,
    },
  }));
  notePlanReadyCycle(id, next);
  maybeOpenPlanRailOnReady({ sessionID: id, previous: current, next });
};

export const applySessionPlan = (sessionID: string, plan: SessionPlan | null): void => {
  if (!plan) return;
  bumpPlanRevision(sessionID);
  // Do not clear `implemented` on GET/event off. After implement settles to
  // off, leftover adapter implementing/ready must stay ignored. Exit/start
  // still call clearPlanImplemented.
  const previous = usePiSessionPlanStore.getState().plansBySession[sessionID] ?? null;
  usePiSessionPlanStore.setState((state) => ({
    plansBySession: {
      ...state.plansBySession,
      [sessionID]: plan,
    },
  }));
  notePlanReadyCycle(sessionID, plan);
  maybeOpenPlanRailOnReady({ sessionID, previous, next: plan });
};

export const refreshSessionPlan = async (sessionID: string): Promise<SessionPlan | null> => {
  const startedRevision = planRevisionBySession[sessionID] ?? 0;
  const plan = await fetchSessionPlan(sessionID);
  if ((planRevisionBySession[sessionID] ?? 0) !== startedRevision) return plan;
  const current = usePiSessionPlanStore.getState().plansBySession[sessionID];
  // A GET that still says off must not wipe optimistic / just-started Plan.
  // Explicit exit still goes through dispatchSessionPlanAction → applySessionPlan.
  // After implement, skip stale off→ready and ready-over-implementing.
  if (shouldSkipIncomingPlan(sessionID, plan)) {
    return current ?? plan;
  }
  applySessionPlan(sessionID, plan);
  return plan;
};

const answerPendingPlanReadyPrompt = async (
  sessionID: string,
  action: SessionPlanAction,
): Promise<boolean> => {
  if (action !== 'implement' && action !== 'save' && action !== 'exit') return false;
  const prompts = usePiExtensionUiStore.getState().promptsBySession[sessionID] ?? [];
  for (let index = prompts.length - 1; index >= 0; index -= 1) {
    const prompt = prompts[index];
    if (!prompt || !isPlanReadyDecisionPrompt(prompt)) continue;
    const option = planReadyOptionForAction(prompt.options, action);
    if (!option) continue;
    await replyPiExtensionUi(sessionID, prompt.id, option);
    return true;
  }
  return false;
};

export const dispatchSessionPlanAction = async (
  sessionID: string,
  action: SessionPlanAction,
  options: { model?: string } = {},
): Promise<SessionPlan | null> => {
  if (action === 'implement' && isPlanImplemented(sessionID)) {
    return usePiSessionPlanStore.getState().plansBySession[sessionID] ?? null;
  }
  try {
    if (await answerPendingPlanReadyPrompt(sessionID, action)) {
      if (action === 'exit') {
        clearPendingDraftPlan(sessionID);
        clearPlanImplemented(sessionID);
      }
      if (action === 'implement') {
        markPlanImplemented(sessionID);
        const current = usePiSessionPlanStore.getState().plansBySession[sessionID];
        if (current && (current.status === 'ready' || current.status === 'saved')) {
          const next = {
            status: 'implementing' as const,
            planMarkdown: current.planMarkdown,
            ...(current.title ? { title: current.title } : {}),
          };
          applySessionPlan(sessionID, next);
          return next;
        }
      }
      const plan = await refreshSessionPlan(sessionID);
      return usePiSessionPlanStore.getState().plansBySession[sessionID] ?? plan;
    }
  } catch {
    // Prompt already gone: fall through to POST /plan <action>.
  }
  if (action === 'implement' && isPlanImplemented(sessionID)) {
    return usePiSessionPlanStore.getState().plansBySession[sessionID] ?? null;
  }
  const plan = await runSessionPlanAction(sessionID, action, options);
  if (action === 'implement' && plan) {
    markPlanImplemented(sessionID);
  }
  if (action === 'start') {
    clearPlanImplemented(sessionID);
    if (plan && isFooterPlanSelected(plan.status)) {
      applySessionPlan(sessionID, plan);
      clearPendingDraftPlan(sessionID);
      return plan;
    }
    // Failed or still-off start must not drop first-send Plan chrome.
    return usePiSessionPlanStore.getState().plansBySession[sessionID] ?? plan;
  }
  if (action === 'exit') {
    clearPendingDraftPlan(sessionID);
    clearPlanImplemented(sessionID);
  }
  applySessionPlan(sessionID, plan);
  return plan;
};

export const applySessionPlanEvent = (value: unknown): SessionPlan | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as { sessionID?: unknown; plan?: unknown };
  if (typeof record.sessionID !== 'string' || !record.sessionID.trim()) return null;
  const plan = parseSessionPlan(record.plan);
  if (shouldSkipIncomingPlan(record.sessionID, plan)) {
    return usePiSessionPlanStore.getState().plansBySession[record.sessionID] ?? plan;
  }
  applySessionPlan(record.sessionID, plan);
  return plan;
};

export const usePendingDraftPlan = (sessionID: string | null | undefined): boolean => (
  usePiSessionPlanStore((state) => (
    sessionID ? state.pendingDraftPlanBySession[sessionID] === true : false
  ))
);

export const useSessionPlan = (sessionID: string | null | undefined): SessionPlan | null => (
  usePiSessionPlanStore((state) => (sessionID ? state.plansBySession[sessionID] ?? null : null))
);

export const usePlanImplemented = (sessionID: string | null | undefined): boolean => (
  usePiSessionPlanStore((state) => (
    sessionID ? state.implementedBySession[sessionID] === true : false
  ))
);

/** Q&A / ready-select 「在此实现」 shares composer Build's implement chrome write. */
export const answerPiExtensionPlanReadyOption = async (
  sessionID: string,
  prompt: {
    kind: string;
    status?: string;
    title?: string;
    options?: readonly string[];
  },
  option: unknown,
): Promise<boolean> => {
  if (!isPlanReadyDecisionPrompt(prompt)) return false;
  const raw = typeof option === 'string' ? option : '';
  if (!raw || !isPlanReadyImplementHereOption(raw)) return false;
  await dispatchSessionPlanAction(sessionID, 'implement');
  return true;
};
