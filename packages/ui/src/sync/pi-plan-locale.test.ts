import { describe, expect, test } from 'bun:test';

import { dict as enDict } from '@/lib/i18n/messages/en';
import { dict as zhCnDict } from '@/lib/i18n/messages/zh-CN';
import {
  isPlanModeEnabledNotify,
  isPlanReadyDecisionPrompt,
  localizePiPlanNotifyMessage,
  localizePiPlanSelectOption,
  localizePiPlanSelectTitle,
  planNotifyDedupeKey,
} from './pi-plan-locale';
import { PLAN_MODE_ENABLED_NOTIFY } from './pi-session-plan';

const tEn = (key: keyof typeof enDict) => enDict[key];
const tZh = (key: keyof typeof zhCnDict) => zhCnDict[key];
const readyTitle = 'Proposed plan ready. What next?';

describe('pi-plan-locale', () => {
  test('maps the start-Plan notify to the app locale', () => {
    expect(isPlanModeEnabledNotify(PLAN_MODE_ENABLED_NOTIFY)).toBe(true);
    expect(isPlanModeEnabledNotify('Plan mode enabled.')).toBe(false);
    expect(isPlanModeEnabledNotify('Something else')).toBe(false);
    expect(planNotifyDedupeKey(PLAN_MODE_ENABLED_NOTIFY)).toBe('chat.piPlan.enabledNotify');
    expect(localizePiPlanNotifyMessage(PLAN_MODE_ENABLED_NOTIFY, tZh)).toBe(
      zhCnDict['chat.piPlan.enabledNotify'],
    );
    expect(localizePiPlanNotifyMessage(PLAN_MODE_ENABLED_NOTIFY, tZh)).not.toBe(PLAN_MODE_ENABLED_NOTIFY);
  });

  test('maps the plan-ready select title and options, leaving unknown copy alone', () => {
    const title = 'Proposed plan ready. What next? Implement here keeps this planning conversation. Start fresh transfers only the approved plan to a new session. After Implement: Keep plan active until /plan exit.';
    expect(localizePiPlanSelectTitle(title, tZh)).toBe(zhCnDict['chat.piPlan.readySelect.title']);
    expect(localizePiPlanSelectTitle(title, tZh)).not.toBe(title);
    expect(localizePiPlanSelectTitle('Scope: How wide?', tZh)).toBe('Scope: How wide?');

    expect(localizePiPlanSelectOption('Start fresh and implement — Open a new linked session; transfer only the approved plan.', tZh)).toEqual({
      label: zhCnDict['chat.piPlan.readySelect.implementFresh'],
      description: zhCnDict['chat.piPlan.readySelect.implementFreshDescription'],
      raw: 'Start fresh and implement — Open a new linked session; transfer only the approved plan.',
    });
    expect(localizePiPlanSelectOption('1. Implement here', tEn)).toEqual({
      label: 'Implement here',
      description: enDict['chat.piPlan.readySelect.implementHereDescription'],
      raw: '1. Implement here',
    });
    expect(localizePiPlanSelectOption('Export plan…', tZh).label).toBe(zhCnDict['chat.piPlan.readySelect.export']);
    expect(localizePiPlanSelectOption('Fast path — ship now', tZh)).toEqual({
      label: 'Fast path',
      description: 'ship now',
      raw: 'Fast path — ship now',
    });
  });

  test('recognizes the plan-ready decision select without treating /plan start as one', () => {
    expect(isPlanReadyDecisionPrompt({
      kind: 'select',
      status: 'pending',
      title: readyTitle,
      options: ['Implement here', 'Start fresh and implement'],
    })).toBe(true);
    expect(isPlanReadyDecisionPrompt({
      kind: 'select',
      status: 'pending',
      title: 'Plan mode',
      options: ['Start plan mode', 'Tools', 'Settings'],
    })).toBe(false);
    expect(isPlanReadyDecisionPrompt({
      kind: 'select',
      status: 'replied',
      title: 'Proposed plan ready. What next?',
      options: ['Implement here'],
    })).toBe(false);
  });
});
