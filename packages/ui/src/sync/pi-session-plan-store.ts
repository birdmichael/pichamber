import { create } from 'zustand';

import {
  fetchSessionPlan,
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

export const resetPiSessionPlanStore = (): void => {
  usePiSessionPlanStore.setState(empty);
};

export const applySessionPlan = (sessionID: string, plan: SessionPlan | null): void => {
  if (!plan) return;
  usePiSessionPlanStore.setState((state) => ({
    plansBySession: {
      ...state.plansBySession,
      [sessionID]: plan,
    },
  }));
};

export const refreshSessionPlan = async (sessionID: string): Promise<SessionPlan | null> => {
  const plan = await fetchSessionPlan(sessionID);
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
