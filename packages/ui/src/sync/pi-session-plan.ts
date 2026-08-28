import { runtimeFetch } from '@/lib/runtime-fetch';

const SESSION_PLAN_STATUSES = ['off', 'active', 'ready', 'saved', 'implementing'] as const;

export type SessionPlanStatus = (typeof SESSION_PLAN_STATUSES)[number];
export type SessionPlanAction = 'start' | 'save' | 'implement' | 'exit' | 'resume';

export type SessionPlan = {
  status: SessionPlanStatus;
  planMarkdown: string;
  title?: string;
};

type SessionPlanSide = 'agent' | 'plan';

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

export const parseSessionPlan = (value: unknown): SessionPlan | null => {
  if (!isRecord(value)) return null;
  const status = value.status;
  if (typeof status !== 'string' || !SESSION_PLAN_STATUSES.includes(status as SessionPlanStatus)) {
    return null;
  }
  const planMarkdown = typeof value.planMarkdown === 'string' ? value.planMarkdown : '';
  const title = typeof value.title === 'string' && value.title.trim() ? value.title.trim() : undefined;
  return title
    ? { status: status as SessionPlanStatus, planMarkdown, title }
    : { status: status as SessionPlanStatus, planMarkdown };
};

export const sessionPlanHasMarkdown = (plan: SessionPlan | null | undefined): boolean => {
  if (!plan) return false;
  return (plan.status === 'ready' || plan.status === 'saved' || plan.status === 'implementing')
    && plan.planMarkdown.trim().length > 0;
};

/** Confirm + /plan exit only when chrome has a ready, saved, or implementing document. */
export const sessionPlanCanDiscard = (plan: SessionPlan | null | undefined): boolean => (
  sessionPlanHasMarkdown(plan)
);

/** View Plan while Plan is on, even before the model writes markdown. */
export const sessionPlanViewAvailable = (plan: SessionPlan | null | undefined): boolean => {
  if (!plan) return false;
  return plan.status === 'active'
    || plan.status === 'ready'
    || plan.status === 'saved'
    || plan.status === 'implementing';
};

export const PLAN_MODE_ENABLED_NOTIFY =
  'Plan mode enabled. I will explore and plan, but not modify files.';

export const isFooterPlanSelected = (status: SessionPlanStatus | null | undefined): boolean => (
  status === 'active' || status === 'ready'
);

const trimmedSessionID = (sessionID?: string | null): string => (
  typeof sessionID === 'string' ? sessionID.trim() : ''
);

/** Open chat first. Draft Plan intent only when none of these name a session. */
export const resolvePlanChromeSessionID = (input: {
  sessionID?: string | null;
  currentSessionID?: string | null;
  routeSessionID?: string | null;
  lastActiveSessionID?: string | null;
}): string => (
  trimmedSessionID(input.sessionID)
  || trimmedSessionID(input.currentSessionID)
  || trimmedSessionID(input.routeSessionID)
  || trimmedSessionID(input.lastActiveSessionID)
);

export const isPlanChromeDraft = (
  draftOpen: boolean,
  sessionID?: string | null,
): boolean => Boolean(draftOpen && !trimmedSessionID(sessionID));

/** Footer chips: Plan slot on, plus a session id or an idle new-session draft. */
export const canShowPiPlanToggle = (
  available: boolean,
  sessionID?: string | null,
  draftOpen = false,
): boolean => (
  available && Boolean(trimmedSessionID(sessionID) || draftOpen)
);

export const planToggleAction = (
  status: SessionPlanStatus | null | undefined,
  side: SessionPlanSide,
): SessionPlanAction | null => {
  if (side === 'plan') {
    if (status === 'off' || status == null) return 'start';
    if (status === 'saved') return 'resume';
    return null;
  }
  if (status === 'ready') return 'save';
  if (status === 'active') return 'exit';
  return null;
};

export type PlanToggleSelectDecision =
  | { kind: 'draft-intent'; planSelected: boolean }
  | { kind: 'session-action'; sessionID: string; action: SessionPlanAction }
  | { kind: 'noop' };

export type PlanToggleApplyResult =
  | PlanToggleSelectDecision
  | { kind: 'session-action-failed'; sessionID: string; action: SessionPlanAction };

/**
 * Draft Plan is local composer intent. It must not mint a session.
 * An already-open session still maps to /plan start, save, resume, or exit.
 */
export const decidePlanToggleSelect = (input: {
  sessionID?: string | null;
  draftOpen: boolean;
  status?: SessionPlanStatus | null;
  side: SessionPlanSide;
}): PlanToggleSelectDecision => {
  const sessionID = trimmedSessionID(input.sessionID);
  if (!sessionID && input.draftOpen) {
    return { kind: 'draft-intent', planSelected: input.side === 'plan' };
  }
  if (!sessionID) return { kind: 'noop' };
  const action = planToggleAction(input.status, input.side);
  if (!action) return { kind: 'noop' };
  return { kind: 'session-action', sessionID, action };
};

/** Plan chip on a live session, or local Plan intent on an empty new-session draft. */
export const resolveFooterPlanSelected = (input: {
  available: boolean;
  status?: SessionPlanStatus | null;
  sessionID?: string | null;
  draftOpen?: boolean;
  draftPlanSelected?: boolean;
}): boolean => {
  if (!input.available) return false;
  if (isFooterPlanSelected(input.status)) return true;
  return Boolean(input.draftOpen && !trimmedSessionID(input.sessionID) && input.draftPlanSelected);
};

/**
 * Last Agent/Plan choice for the empty composer.
 * Sidebar navigation keeps it; send or an explicit Agent pick consumes it.
 */
export const resolveEmptyComposerPlanSelected = (input: {
  current: boolean;
  draftOpen: boolean;
  draftPlanSelected?: boolean;
  consume?: boolean;
}): boolean => {
  if (input.consume) return false;
  if (input.draftOpen && input.draftPlanSelected !== undefined) return input.draftPlanSelected;
  return input.current;
};

/** Restore last empty-composer Plan when a new-session draft reopens. */
export const resolveOpenedDraftPlanSelected = (
  option: boolean | undefined,
  emptyComposerPlanSelected: boolean,
): boolean => option ?? emptyComposerPlanSelected;

export const shouldStartPlanAfterDraftMaterialize = (
  draftPlanSelected?: boolean,
  status?: SessionPlanStatus | null,
): boolean => (
  draftPlanSelected === true && !isFooterPlanSelected(status)
);

export const applyPlanToggleSelect = async (input: {
  sessionID?: string | null;
  draftOpen: boolean;
  status?: SessionPlanStatus | null;
  side: SessionPlanSide;
  setDraftPlanSelected: (selected: boolean) => void;
  dispatchSessionPlanAction: (
    sessionID: string,
    action: SessionPlanAction,
  ) => Promise<SessionPlan | null>;
}): Promise<PlanToggleApplyResult> => {
  const decision = decidePlanToggleSelect(input);
  if (decision.kind === 'draft-intent') {
    input.setDraftPlanSelected(decision.planSelected);
    return decision;
  }
  if (decision.kind === 'session-action') {
    const next = await input.dispatchSessionPlanAction(decision.sessionID, decision.action);
    if (!next) {
      return { kind: 'session-action-failed', sessionID: decision.sessionID, action: decision.action };
    }
  }
  return decision;
};

export const applyDraftPlanStartAfterMaterialize = async (input: {
  sessionID: string;
  draftPlanSelected?: boolean;
  currentStatus?: SessionPlanStatus | null;
  startPlan: (sessionID: string) => Promise<SessionPlan | null>;
}): Promise<'skipped' | 'started'> => {
  if (!shouldStartPlanAfterDraftMaterialize(input.draftPlanSelected, input.currentStatus)) {
    return 'skipped';
  }
  const next = await input.startPlan(input.sessionID);
  if (!next) throw new Error('Failed to start plan');
  return 'started';
};

export const planBuildAvailable = (status: SessionPlanStatus | null | undefined): boolean => (
  status === 'ready' || status === 'saved'
);

export const fetchSessionPlan = async (sessionID: string): Promise<SessionPlan | null> => {
  const id = sessionID.trim();
  if (!id) return null;
  try {
    const response = await runtimeFetch(`/api/pi/session/${encodeURIComponent(id)}/plan`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return parseSessionPlan(await response.json().catch(() => null));
  } catch {
    return null;
  }
};

export const runSessionPlanAction = async (
  sessionID: string,
  action: SessionPlanAction,
  options: { model?: string } = {},
): Promise<SessionPlan | null> => {
  const id = sessionID.trim();
  if (!id) return null;
  try {
    const response = await runtimeFetch(`/api/pi/session/${encodeURIComponent(id)}/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        action,
        ...(action === 'implement' && options.model ? { model: options.model } : {}),
      }),
    });
    if (!response.ok) return null;
    return parseSessionPlan(await response.json().catch(() => null));
  } catch {
    return null;
  }
};
