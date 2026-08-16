// Live pi-plan-mode status from the session's plan-mode-state custom entry.
// Mirrors @narumitw/pi-plan-mode presentation.formatStatus. Do not scrape TUI
// widgets or read leftover .opencode/plans files.

export const PLAN_MODE_STATE_ENTRY_TYPE = 'plan-mode-state';
const PLAN_MODE_COMPLETE_TOOL_NAME = 'plan_mode_complete';
const SESSION_PLAN_ACTIONS = Object.freeze([
  'start',
  'save',
  'implement',
  'exit',
  'resume',
]);

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const normalizePlanMarkdown = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

export const titleFromPlanMarkdown = (markdown) => {
  const text = normalizePlanMarkdown(markdown);
  if (!text) return undefined;
  const heading = text.match(/^#{1,6}\s+(.+)$/m);
  const line = (heading?.[1] || text.split('\n').find((item) => item.trim()) || '').trim();
  if (!line) return undefined;
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
};

const normalizeSavedPlan = (value) => {
  if (typeof value === 'string') {
    const plan = normalizePlanMarkdown(value);
    return plan ? { plan, source: PLAN_MODE_COMPLETE_TOOL_NAME } : undefined;
  }
  if (!isRecord(value)) return undefined;
  const plan = normalizePlanMarkdown(value.plan);
  if (!plan) return undefined;
  return {
    plan,
    source: value.source === 'legacy_proposed_plan' ? value.source : PLAN_MODE_COMPLETE_TOOL_NAME,
  };
};

const normalizeActiveImplementation = (value) => {
  if (!isRecord(value)) return undefined;
  const plan = normalizePlanMarkdown(value.plan);
  if (!plan) return undefined;
  return {
    id: typeof value.id === 'string' ? value.id : 'implementation',
    plan,
    source: value.source === 'legacy_proposed_plan' ? value.source : PLAN_MODE_COMPLETE_TOOL_NAME,
    startedAt: typeof value.startedAt === 'number' ? value.startedAt : 0,
  };
};

const planFromCompletionDetails = (details) => {
  if (typeof details === 'string') return normalizePlanMarkdown(details) || undefined;
  if (!isRecord(details)) return undefined;
  return normalizePlanMarkdown(details.plan) || undefined;
};

const latestCompletionPlan = (entries) => {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const message = entry?.message || entry;
    const toolName = message?.toolName || entry?.toolName;
    const role = message?.role || entry?.role;
    if (role !== 'toolResult' || toolName !== PLAN_MODE_COMPLETE_TOOL_NAME) continue;
    const plan = planFromCompletionDetails(message?.details || entry?.details);
    if (plan) return plan;
  }
  return undefined;
};

export const restoreSessionPlanState = (entries) => {
  if (!Array.isArray(entries)) {
    return { enabled: false, awaitingAction: false };
  }

  let stateEntryIndex = -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const candidate = entries[index];
    if (candidate?.type === 'custom' && candidate.customType === PLAN_MODE_STATE_ENTRY_TYPE) {
      stateEntryIndex = index;
      break;
    }
  }
  if (stateEntryIndex === -1) {
    return { enabled: false, awaitingAction: false };
  }

  const data = entries[stateEntryIndex]?.data;
  if (!isRecord(data)) {
    return { enabled: false, awaitingAction: false };
  }

  const enabled = data.enabled === true;
  const persistedPlan = enabled ? (normalizePlanMarkdown(data.latestPlan) || undefined) : undefined;
  const recoveredPlan = enabled && !persistedPlan
    ? latestCompletionPlan(entries.slice(stateEntryIndex + 1))
    : undefined;
  const latestPlan = persistedPlan ?? recoveredPlan;
  const activeImplementation = enabled ? undefined : normalizeActiveImplementation(data.activeImplementation);
  const savedPlan = enabled || activeImplementation ? undefined : normalizeSavedPlan(data.savedPlan);

  return {
    enabled,
    latestPlan,
    awaitingAction: enabled && latestPlan !== undefined,
    savedPlan,
    activeImplementation,
  };
};

export const sessionPlanFromState = (state) => {
  const enabled = state?.enabled === true;
  const latestPlan = normalizePlanMarkdown(state?.latestPlan);
  const savedPlan = normalizePlanMarkdown(state?.savedPlan?.plan ?? (typeof state?.savedPlan === 'string' ? state.savedPlan : ''));
  const implementingPlan = normalizePlanMarkdown(state?.activeImplementation?.plan);
  const awaitingAction = state?.awaitingAction === true || Boolean(latestPlan);

  let status = 'off';
  let planMarkdown = '';
  if (enabled) {
    if (awaitingAction && latestPlan) {
      status = 'ready';
      planMarkdown = latestPlan;
    } else if (latestPlan) {
      status = 'ready';
      planMarkdown = latestPlan;
    } else {
      status = 'active';
    }
  } else if (savedPlan) {
    status = 'saved';
    planMarkdown = savedPlan;
  } else if (implementingPlan) {
    status = 'implementing';
    planMarkdown = implementingPlan;
  }

  const title = titleFromPlanMarkdown(planMarkdown);
  return title ? { status, planMarkdown, title } : { status, planMarkdown };
};

export const resumeSavedPlanState = (state) => {
  const saved = normalizeSavedPlan(state?.savedPlan);
  if (!saved || state?.enabled === true) return null;
  return {
    enabled: true,
    latestPlan: saved.plan,
    latestPlanSource: saved.source,
    awaitingAction: true,
    savedPlan: undefined,
    activeImplementation: undefined,
  };
};

export const applyMockPlanCommand = (state, argument) => {
  const current = isRecord(state) ? { ...state } : { enabled: false, awaitingAction: false };
  const command = typeof argument === 'string' ? argument.trim().toLowerCase() : '';

  if (command === 'start') {
    if (current.savedPlan && !current.enabled) {
      const error = new Error('Implement or clear the saved plan before starting another.');
      error.status = 409;
      throw error;
    }
    if (current.enabled) return current;
    return {
      ...current,
      enabled: true,
      awaitingAction: Boolean(current.latestPlan),
      activeImplementation: undefined,
    };
  }

  if (command === 'save') {
    const plan = normalizePlanMarkdown(current.latestPlan);
    if (!current.enabled || !plan) return current;
    return {
      enabled: false,
      awaitingAction: false,
      latestPlan: undefined,
      savedPlan: { plan, source: current.latestPlanSource || PLAN_MODE_COMPLETE_TOOL_NAME },
      activeImplementation: undefined,
    };
  }

  if (command === 'implement') {
    const plan = current.enabled
      ? normalizePlanMarkdown(current.latestPlan)
      : normalizePlanMarkdown(current.savedPlan?.plan);
    if (!plan) return current;
    return {
      enabled: false,
      awaitingAction: false,
      latestPlan: undefined,
      savedPlan: undefined,
      activeImplementation: {
        id: 'implementation',
        plan,
        source: PLAN_MODE_COMPLETE_TOOL_NAME,
        startedAt: Date.now(),
      },
    };
  }

  if (command === 'exit' || command === 'off') {
    return { enabled: false, awaitingAction: false };
  }

  return current;
};

export const parseSessionPlanAction = (body) => {
  const action = typeof body?.action === 'string' ? body.action.trim().toLowerCase() : '';
  if (!SESSION_PLAN_ACTIONS.includes(action)) {
    const error = new Error('Plan action must be start, save, implement, exit, or resume');
    error.status = 400;
    throw error;
  }
  const model = typeof body?.model === 'string' ? body.model.trim() : '';
  return model && action === 'implement' ? { action, model } : { action };
};

export const sessionPlanHasMarkdown = (plan) => (
  Boolean(plan)
  && (plan.status === 'ready' || plan.status === 'saved' || plan.status === 'implementing')
  && normalizePlanMarkdown(plan.planMarkdown).length > 0
);

/** View Plan / Discard chrome while Plan is on, even before the model writes markdown. */
export const sessionPlanViewAvailable = (plan) => (
  Boolean(plan)
  && (plan.status === 'active' || plan.status === 'ready' || plan.status === 'saved' || plan.status === 'implementing')
);
