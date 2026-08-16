import { runtimeFetch } from '@/lib/runtime-fetch';

const SESSION_PLAN_STATUSES = ['off', 'active', 'ready', 'saved', 'implementing'] as const;
const SESSION_PLAN_ACTIONS = ['start', 'save', 'implement', 'exit', 'resume'] as const;

export type SessionPlanStatus = (typeof SESSION_PLAN_STATUSES)[number];
export type SessionPlanAction = (typeof SESSION_PLAN_ACTIONS)[number];

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

export const isFooterPlanSelected = (status: SessionPlanStatus | null | undefined): boolean => (
  status === 'active' || status === 'ready'
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
  return null;
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
