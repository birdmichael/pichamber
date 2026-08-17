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

export const localizePiPlanSelectTitle = (
  title: string,
  t: (key: I18nKey) => string,
): string => (
  isPlanReadyDecisionTitle(title) ? t('chat.piPlan.readySelect.title') : title
);

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
