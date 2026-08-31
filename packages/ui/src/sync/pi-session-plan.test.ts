import { afterEach, describe, expect, test } from 'bun:test';

import {
  applyDraftPlanStartAfterMaterialize,
  applyPlanToggleSelect,
  canShowPiPlanToggle,
  decidePlanToggleSelect,
  isFooterPlanSelected,
  isPlanChromeDraft,
  resolvePlanChromeSessionID,
  parseSessionPlan,
  planBuildAvailable,
  planToggleAction,
  resolveEmptyComposerPlanSelected,
  resolveFooterPlanSelected,
  resolveOpenedDraftPlanSelected,
  planBuildBusyDisabled,
  resolvePlanStatusRowHint,
  sessionPlanCanDiscard,
  sessionPlanHasMarkdown,
  sessionPlanViewAvailable,
  shouldStartPlanAfterDraftMaterialize,
} from './pi-session-plan';
import { resetPlanReadyRailOpenForTests } from './pi-plan-ready';
import {
  adoptDraftPlanForSession,
  applySessionPlan,
  applySessionPlanEvent,
  isPendingDraftPlan,
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

  test('draft Plan select stays local and does not imply a session action', () => {
    expect(decidePlanToggleSelect({
      sessionID: null,
      draftOpen: true,
      status: 'off',
      side: 'plan',
    })).toEqual({ kind: 'draft-intent', planSelected: true });
    expect(decidePlanToggleSelect({
      sessionID: '',
      draftOpen: true,
      status: 'off',
      side: 'agent',
    })).toEqual({ kind: 'draft-intent', planSelected: false });
    expect(shouldStartPlanAfterDraftMaterialize(true)).toBe(true);
    expect(shouldStartPlanAfterDraftMaterialize(false)).toBe(false);
  });

  test('footer can show Plan from draft intent without a session status', () => {
    expect(resolveFooterPlanSelected({
      available: true,
      status: 'off',
      sessionID: null,
      draftOpen: true,
      draftPlanSelected: true,
    })).toBe(true);
    expect(resolveFooterPlanSelected({
      available: true,
      status: 'off',
      sessionID: null,
      draftOpen: true,
      draftPlanSelected: false,
    })).toBe(false);
    expect(resolveFooterPlanSelected({
      available: true,
      status: 'active',
      sessionID: 'ses_1',
      draftOpen: false,
      draftPlanSelected: false,
    })).toBe(true);
    expect(resolveFooterPlanSelected({
      available: false,
      draftOpen: true,
      draftPlanSelected: true,
    })).toBe(false);
    expect(resolveFooterPlanSelected({
      available: true,
      status: 'off',
      sessionID: 'ses_new',
      draftOpen: false,
      draftPlanSelected: true,
    })).toBe(true);
    expect(resolveFooterPlanSelected({
      available: true,
      status: 'off',
      sessionID: 'ses_new',
      draftOpen: false,
      draftPlanSelected: false,
      pendingDraftPlan: true,
    })).toBe(true);
    expect(resolveFooterPlanSelected({
      available: true,
      status: 'off',
      sessionID: 'ses_new',
      draftOpen: false,
      draftPlanSelected: false,
      pendingDraftPlan: false,
    })).toBe(false);
    expect(resolvePlanStatusRowHint({
      footerPlanSelected: true,
      draftOpen: true,
    })).toBe('draft');
    expect(resolvePlanStatusRowHint({
      footerPlanSelected: true,
      draftOpen: false,
    })).toBe('enabled');
    expect(resolvePlanStatusRowHint({
      footerPlanSelected: false,
      draftOpen: true,
    })).toBeNull();
    expect(resolvePlanStatusRowHint({
      footerPlanSelected: true,
      draftOpen: false,
      implemented: true,
    })).toBe('implementing');
    expect(resolvePlanStatusRowHint({
      footerPlanSelected: false,
      draftOpen: false,
      implementing: true,
    })).toBe('implementing');
    expect(planBuildBusyDisabled({ busy: true, hasPendingPlanReadySelect: true })).toBe(false);
    expect(planBuildBusyDisabled({ busy: true, hasPendingPlanReadySelect: false })).toBe(true);
    expect(planBuildBusyDisabled({ busy: false, hasPendingPlanReadySelect: false })).toBe(false);
  });

  test('empty-composer Plan stays on this draft until send or Agent, and a new draft is Agent', () => {
    expect(resolveEmptyComposerPlanSelected({
      current: false,
      draftOpen: true,
      draftPlanSelected: true,
    })).toBe(true);
    expect(resolveEmptyComposerPlanSelected({
      current: true,
      draftOpen: false,
    })).toBe(true);
    expect(resolveEmptyComposerPlanSelected({
      current: true,
      draftOpen: true,
      draftPlanSelected: false,
    })).toBe(false);
    expect(resolveEmptyComposerPlanSelected({
      current: true,
      draftOpen: true,
      draftPlanSelected: true,
      consume: true,
    })).toBe(false);
    expect(resolveOpenedDraftPlanSelected(undefined)).toBe(false);
    expect(resolveOpenedDraftPlanSelected(true)).toBe(true);
    expect(resolveOpenedDraftPlanSelected(false)).toBe(false);
  });

  test('Plan chrome prefers the open chat over an auto-draft welcome', () => {
    expect(resolvePlanChromeSessionID({
      currentSessionID: null,
      routeSessionID: 'ses_route',
      lastActiveSessionID: 'ses_last',
    })).toBe('ses_route');
    expect(resolvePlanChromeSessionID({
      currentSessionID: null,
      routeSessionID: '',
      lastActiveSessionID: 'ses_last',
    })).toBe('ses_last');
    expect(resolvePlanChromeSessionID({
      sessionID: 'ses_override',
      currentSessionID: 'ses_current',
      routeSessionID: 'ses_route',
    })).toBe('ses_override');
    expect(isPlanChromeDraft(true, 'ses_route')).toBe(false);
    expect(isPlanChromeDraft(true, null)).toBe(true);
    expect(isPlanChromeDraft(true, '')).toBe(true);
    expect(decidePlanToggleSelect({
      sessionID: resolvePlanChromeSessionID({
        currentSessionID: null,
        routeSessionID: 'ses_route',
      }),
      draftOpen: isPlanChromeDraft(true, 'ses_route'),
      status: 'off',
      side: 'plan',
    })).toEqual({
      kind: 'session-action',
      sessionID: 'ses_route',
      action: 'start',
    });
  });

  test('existing-session Plan toggle stays on that session and never creates one', async () => {
    const starts: string[] = [];
    const result = await applyPlanToggleSelect({
      sessionID: 'ses_open',
      draftOpen: false,
      status: 'off',
      side: 'plan',
      setDraftPlanSelected: () => {
        throw new Error('draft intent must not run on an open session');
      },
      dispatchSessionPlanAction: async (sessionID, action) => {
        starts.push(`${action}:${sessionID}`);
        return { status: 'active', planMarkdown: '' };
      },
    });
    expect(result).toEqual({
      kind: 'session-action',
      sessionID: 'ses_open',
      action: 'start',
    });
    expect(starts).toEqual(['start:ses_open']);
    expect(decidePlanToggleSelect({
      sessionID: 'ses_open',
      draftOpen: true,
      status: 'off',
      side: 'plan',
    })).toEqual({
      kind: 'session-action',
      sessionID: 'ses_open',
      action: 'start',
    });
  });

  test('draft Plan select applies local intent and never creates a session', async () => {
    let draftPlanSelected = false;
    const result = await applyPlanToggleSelect({
      sessionID: null,
      draftOpen: true,
      status: 'off',
      side: 'plan',
      setDraftPlanSelected: (selected) => {
        draftPlanSelected = selected;
      },
      dispatchSessionPlanAction: async () => {
        throw new Error('draft Plan must not /plan start');
      },
    });
    expect(result).toEqual({ kind: 'draft-intent', planSelected: true });
    expect(draftPlanSelected).toBe(true);
    expect(Object.keys(result)).not.toContain('sessionID');
  });

  test('send from a Plan-selected draft starts plan after that session exists', async () => {
    const starts: string[] = [];
    const started = await applyDraftPlanStartAfterMaterialize({
      sessionID: 'ses_new',
      draftPlanSelected: true,
      currentStatus: 'active',
      startPlan: async (sessionID) => {
        starts.push(sessionID);
        return { status: 'active', planMarkdown: '' };
      },
    });
    expect(started).toBe('started');
    expect(starts).toEqual(['ses_new']);

    const skipped = await applyDraftPlanStartAfterMaterialize({
      sessionID: 'ses_new',
      draftPlanSelected: false,
      startPlan: async () => {
        throw new Error('Agent send must not start plan');
      },
    });
    expect(skipped).toBe('skipped');
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

  test('adopted first-send Plan survives a later off event', () => {
    adoptDraftPlanForSession('ses_new');
    expect(isPendingDraftPlan('ses_new')).toBe(true);
    expect(usePiSessionPlanStore.getState().plansBySession.ses_new?.status).toBe('active');
    applySessionPlanEvent({
      sessionID: 'ses_new',
      plan: { status: 'off', planMarkdown: '' },
    });
    expect(usePiSessionPlanStore.getState().plansBySession.ses_new?.status).toBe('active');
    expect(isPendingDraftPlan('ses_new')).toBe(true);
  });
});
