import type { I18nKey } from '@/lib/i18n';
import { displaySelectOption } from './pi-extension-ui';
import { PLAN_MODE_ENABLED_NOTIFY } from './pi-session-plan';

const PLAN_READY_SELECT_TITLE_PREFIX = 'Proposed plan ready';

const READY_OPTION_LABELS: ReadonlyArray<{
  label: string;
  labelKey: I18nKey;
  descriptionKey?: I18nKey;
}> = [
  {
    label: 'implement here',
    labelKey: 'chat.piPlan.readySelect.implementHere',
    descriptionKey: 'chat.piPlan.readySelect.implementHereDescription',
  },
  {
    label: 'start fresh and implement',
    labelKey: 'chat.piPlan.readySelect.implementFresh',
    descriptionKey: 'chat.piPlan.readySelect.implementFreshDescription',
  },
  {
    label: 'export plan…',
    labelKey: 'chat.piPlan.readySelect.export',
  },
  {
    label: 'export plan...',
    labelKey: 'chat.piPlan.readySelect.export',
  },
  {
    label: 'save for later',
    labelKey: 'chat.piPlan.readySelect.save',
  },
  {
    label: 'stay in plan mode',
    labelKey: 'chat.piPlan.readySelect.stay',
  },
  {
    label: 'discard plan and exit',
    labelKey: 'chat.piPlan.readySelect.exit',
  },
];

const normalizeOptionLabel = (value: string): string => (
  value.trim().replace(/…/g, '...').replace(/\s+/g, ' ').toLowerCase()
);

export const isPlanModeEnabledNotify = (message: string): boolean => (
  message.trim() === PLAN_MODE_ENABLED_NOTIFY
);

export const planNotifyDedupeKey = (message: string): string => (
  isPlanModeEnabledNotify(message) ? 'chat.piPlan.enabledNotify' : message.trim()
);

export const localizePiPlanNotifyMessage = (
  message: string,
  t: (key: I18nKey) => string,
): string => (
  isPlanModeEnabledNotify(message) ? t('chat.piPlan.enabledNotify') : message
);

const isPlanReadyDecisionTitle = (title: string): boolean => (
  title.trim().toLowerCase().includes(PLAN_READY_SELECT_TITLE_PREFIX.toLowerCase())
);

export const isPlanReadyDecisionPrompt = (prompt: {
  kind: string;
  status?: string;
  title?: string;
  options?: readonly string[];
}): boolean => {
  if (prompt.kind !== 'select') return false;
  if (prompt.status && prompt.status !== 'pending') return false;
  if (isPlanReadyDecisionTitle(prompt.title ?? '')) return true;
  return (prompt.options ?? []).some((option) => {
    const label = normalizeOptionLabel(displaySelectOption(option).label);
    return label === 'implement here' || label === 'start fresh and implement';
  });
};

export type PlanReadyRailAction = 'implement' | 'save' | 'exit';

const PLAN_READY_OPTION_BY_ACTION: Record<PlanReadyRailAction, string> = {
  implement: 'implement here',
  save: 'save for later',
  exit: 'discard plan and exit',
};

/** Raw ctx.ui option for a View Plan rail action, or null if that card is absent. */
export const planReadyOptionForAction = (
  options: readonly string[] | undefined,
  action: PlanReadyRailAction,
): string | null => {
  const wanted = PLAN_READY_OPTION_BY_ACTION[action];
  for (const option of options ?? []) {
    if (normalizeOptionLabel(displaySelectOption(option).label) === wanted) return option;
  }
  return null;
};

const PLAN_POLICY_ALLOWLIST_DUMP = /plan policy will allow:/i;

/** First line of a Plan select title. Drops the tool-allowlist dump. */
export const displayPiPlanSelectTitle = (title: string): string => {
  const lines = title.split(/\n/);
  const heading = (lines[0] ?? '').trim();
  if (!heading) return title.trim();
  return heading;
};

export const localizePiPlanSelectTitle = (
  title: string,
  t: (key: I18nKey) => string,
): string => {
  if (isPlanReadyDecisionTitle(title)) return t('chat.piPlan.readySelect.title');
  const heading = displayPiPlanSelectTitle(title);
  if (PLAN_POLICY_ALLOWLIST_DUMP.test(title) || PLAN_POLICY_ALLOWLIST_DUMP.test(heading)) {
    return heading;
  }
  return heading === title.trim() ? title : heading;
};

export const localizePiPlanSelectOption = (
  option: string,
  t: (key: I18nKey) => string,
): { label: string; description?: string; raw: string } => {
  const parsed = displaySelectOption(option);
  const match = READY_OPTION_LABELS.find((entry) => (
    normalizeOptionLabel(parsed.label) === entry.label
  ));
  if (!match) return parsed;
  return {
    label: t(match.labelKey),
    description: match.descriptionKey ? t(match.descriptionKey) : parsed.description,
    raw: option,
  };
};
