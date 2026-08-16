import { afterEach, describe, expect, test } from 'bun:test';

import {
  isFooterPlanSelected,
  parseSessionPlan,
  planBuildAvailable,
  planToggleAction,
  sessionPlanHasMarkdown,
} from './pi-session-plan';
import {
  applySessionPlan,
  applySessionPlanEvent,
  resetPiSessionPlanStore,
  usePiSessionPlanStore,
} from './pi-session-plan-store';

afterEach(() => {
  resetPiSessionPlanStore();
});

describe('parseSessionPlan', () => {
  test('accepts live extension statuses and rejects empty-success lookalikes', () => {
    expect(parseSessionPlan({ status: 'off', planMarkdown: '' })).toEqual({
      status: 'off',
      planMarkdown: '',
    });
    expect(parseSessionPlan({
      status: 'ready',
      planMarkdown: '# Title\n\nBody',
      title: 'Title',
    })).toEqual({
      status: 'ready',
      planMarkdown: '# Title\n\nBody',
      title: 'Title',
    });
    expect(parseSessionPlan({ status: 'planning', planMarkdown: '' })).toBeNull();
    expect(parseSessionPlan({ planMarkdown: '' })).toBeNull();
    expect(parseSessionPlan(null)).toBeNull();
  });
});

describe('plan toggle and build dispatch', () => {
  test('maps Agent|Plan clicks to start/save/resume and never /plan exit', () => {
    expect(planToggleAction('off', 'plan')).toBe('start');
    expect(planToggleAction('saved', 'plan')).toBe('resume');
    expect(planToggleAction('active', 'plan')).toBeNull();
    expect(planToggleAction('ready', 'plan')).toBeNull();
    expect(planToggleAction('implementing', 'plan')).toBeNull();

    expect(planToggleAction('ready', 'agent')).toBe('save');
    expect(planToggleAction('active', 'agent')).toBeNull();
    expect(planToggleAction('saved', 'agent')).toBeNull();
    expect(planToggleAction('off', 'agent')).toBeNull();
    expect(planToggleAction('implementing', 'agent')).toBeNull();
  });

  test('Build is only available for ready or saved markdown', () => {
    expect(planBuildAvailable('ready')).toBe(true);
    expect(planBuildAvailable('saved')).toBe(true);
    expect(planBuildAvailable('active')).toBe(false);
    expect(planBuildAvailable('off')).toBe(false);
    expect(planBuildAvailable('implementing')).toBe(false);
    expect(sessionPlanHasMarkdown({ status: 'ready', planMarkdown: '# Plan' })).toBe(true);
    expect(sessionPlanHasMarkdown({ status: 'active', planMarkdown: '' })).toBe(false);
    expect(isFooterPlanSelected('active')).toBe(true);
    expect(isFooterPlanSelected('saved')).toBe(false);
    expect(isFooterPlanSelected('implementing')).toBe(false);
  });
});

describe('pi-session-plan-store', () => {
  test('does not treat a failed fetch as empty off', () => {
    applySessionPlan('ses_1', { status: 'ready', planMarkdown: '# Keep' });
    applySessionPlan('ses_1', null);
    applySessionPlanEvent({ sessionID: 'ses_1', plan: { status: 'nope' } });
    expect(usePiSessionPlanStore.getState().plansBySession.ses_1).toEqual({
      status: 'ready',
      planMarkdown: '# Keep',
    });
  });
});
