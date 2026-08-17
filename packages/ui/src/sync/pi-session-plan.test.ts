import { afterEach, describe, expect, test } from 'bun:test';

import {
  canShowPiPlanToggle,
  isFooterPlanSelected,
  parseSessionPlan,
  planBuildAvailable,
  planToggleAction,
  sessionPlanCanDiscard,
  sessionPlanHasMarkdown,
  sessionPlanViewAvailable,
} from './pi-session-plan';
import { resetPlanReadyRailOpenForTests } from './pi-plan-ready';
import {
  applySessionPlan,
  applySessionPlanEvent,
  resetPiSessionPlanStore,
  usePiSessionPlanStore,
} from './pi-session-plan-store';

afterEach(() => {
  resetPiSessionPlanStore();
  resetPlanReadyRailOpenForTests();
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
  test('maps Agent|Plan clicks to start/save/resume and exit when Plan is on without a document', () => {
    expect(planToggleAction('off', 'plan')).toBe('start');
    expect(planToggleAction('saved', 'plan')).toBe('resume');
    expect(planToggleAction('active', 'plan')).toBeNull();
    expect(planToggleAction('ready', 'plan')).toBeNull();
    expect(planToggleAction('implementing', 'plan')).toBeNull();

    expect(planToggleAction('ready', 'agent')).toBe('save');
    expect(planToggleAction('active', 'agent')).toBe('exit');
    expect(planToggleAction('saved', 'agent')).toBeNull();
    expect(planToggleAction('off', 'agent')).toBeNull();
    expect(planToggleAction('implementing', 'agent')).toBeNull();
  });

  test('shows the footer toggle on an idle draft or session without waiting for a plan fetch', () => {
    expect(canShowPiPlanToggle(true, 'ses_1', false)).toBe(true);
    expect(canShowPiPlanToggle(true, null, true)).toBe(true);
    expect(canShowPiPlanToggle(true, '', false)).toBe(false);
    expect(canShowPiPlanToggle(false, 'ses_1', true)).toBe(false);
  });

  test('Build is only available for ready or saved markdown', () => {
    expect(planBuildAvailable('ready')).toBe(true);
    expect(planBuildAvailable('saved')).toBe(true);
    expect(planBuildAvailable('active')).toBe(false);
    expect(planBuildAvailable('off')).toBe(false);
    expect(planBuildAvailable('implementing')).toBe(false);
    expect(sessionPlanHasMarkdown({ status: 'ready', planMarkdown: '# Plan' })).toBe(true);
    expect(sessionPlanHasMarkdown({ status: 'active', planMarkdown: '' })).toBe(false);
    expect(sessionPlanViewAvailable({ status: 'active', planMarkdown: '' })).toBe(true);
    expect(sessionPlanViewAvailable({ status: 'off', planMarkdown: '' })).toBe(false);
    expect(isFooterPlanSelected('active')).toBe(true);
    expect(isFooterPlanSelected('saved')).toBe(false);
    expect(isFooterPlanSelected('implementing')).toBe(false);
  });

  test('empty-plan Discard gate uses chrome status and markdown, not a local empty string', () => {
    expect(sessionPlanCanDiscard({ status: 'active', planMarkdown: '' })).toBe(false);
    expect(sessionPlanCanDiscard({ status: 'active', planMarkdown: '   ' })).toBe(false);
    expect(sessionPlanCanDiscard({ status: 'off', planMarkdown: '' })).toBe(false);
    expect(sessionPlanCanDiscard({ status: 'ready', planMarkdown: '' })).toBe(false);
    expect(sessionPlanCanDiscard({ status: 'ready', planMarkdown: '   ' })).toBe(false);
    expect(sessionPlanCanDiscard({ status: 'saved', planMarkdown: '' })).toBe(false);
    expect(sessionPlanCanDiscard(null)).toBe(false);
    expect(sessionPlanCanDiscard({ status: 'ready', planMarkdown: '# Ready plan' })).toBe(true);
    expect(sessionPlanCanDiscard({ status: 'saved', planMarkdown: '# Saved plan' })).toBe(true);
    expect(sessionPlanCanDiscard({ status: 'implementing', planMarkdown: '# Building' })).toBe(true);
    expect(sessionPlanCanDiscard({ status: 'active', planMarkdown: '# leftover' })).toBe(false);
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
