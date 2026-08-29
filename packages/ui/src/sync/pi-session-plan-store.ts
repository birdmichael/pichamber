import { create } from 'zustand';

import { maybeOpenPlanRailOnReady, notePlanReadyCycle } from './pi-plan-ready';
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
};

const empty: PiSessionPlanState = { plansBySession: {} };

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

export const applySessionPlan = (sessionID: string, plan: SessionPlan | null): void => {
  if (!plan) return;
  bumpPlanRevision(sessionID);
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
  if (current && isFooterPlanSelected(current.status) && plan?.status === 'off') {
    return current;
  }
  applySessionPlan(sessionID, plan);
  return plan;
};

export const dispatchSessionPlanAction = async (
  sessionID: string,
  action: SessionPlanAction,
  options: { model?: string } = {},
): Promise<SessionPlan | null> => {
  const plan = await runSessionPlanAction(sessionID, action, options);
  applySessionPlan(sessionID, plan);
  return plan;
};

export const applySessionPlanEvent = (value: unknown): SessionPlan | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as { sessionID?: unknown; plan?: unknown };
  if (typeof record.sessionID !== 'string' || !record.sessionID.trim()) return null;
  const plan = parseSessionPlan(record.plan);
  applySessionPlan(record.sessionID, plan);
  return plan;
};

export const useSessionPlan = (sessionID: string | null | undefined): SessionPlan | null => (
  usePiSessionPlanStore((state) => (sessionID ? state.plansBySession[sessionID] ?? null : null))
);
