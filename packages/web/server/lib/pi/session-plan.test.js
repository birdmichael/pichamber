import { describe, expect, it } from 'vitest';

import {
  PLAN_MODE_STATE_ENTRY_TYPE,
  applyMockPlanCommand,
  parseSessionPlanAction,
  resolvePlanModeState,
  restoreSessionPlanState,
  resumeSavedPlanState,
  sessionPlanFromState,
  sessionPlanHasMarkdown,
  sessionPlanViewAvailable,
  titleFromPlanMarkdown,
} from './session-plan.js';

const stateEntry = (data) => ({
  type: 'custom',
  customType: PLAN_MODE_STATE_ENTRY_TYPE,
  data,
});

describe('session-plan', () => {
  it('maps live plan-mode-state to off/active/ready/saved/implementing', () => {
    expect(sessionPlanFromState({ enabled: false, awaitingAction: false })).toEqual({
      status: 'off',
      planMarkdown: '',
    });
    expect(sessionPlanFromState({ enabled: true, awaitingAction: false })).toEqual({
      status: 'active',
      planMarkdown: '',
    });
    expect(sessionPlanFromState({
      enabled: true,
      awaitingAction: true,
      latestPlan: '# Ship it\n\nDo the work.',
    })).toMatchObject({
      status: 'ready',
      planMarkdown: '# Ship it\n\nDo the work.',
      title: 'Ship it',
    });
    expect(sessionPlanFromState({
      enabled: false,
      savedPlan: { plan: 'Saved body' },
    })).toMatchObject({
      status: 'saved',
      planMarkdown: 'Saved body',
    });
    expect(sessionPlanFromState({
      enabled: false,
      activeImplementation: { plan: 'Implement this' },
    })).toMatchObject({
      status: 'implementing',
      planMarkdown: 'Implement this',
    });
  });

  it('prefers jsonl plan-mode-state when live getPlanModeState is empty', () => {
    expect(resolvePlanModeState(null, [
      stateEntry({ enabled: true, awaitingAction: false }),
    ])).toMatchObject({ enabled: true });
    expect(resolvePlanModeState({ enabled: false }, [
      stateEntry({ enabled: true }),
    ])).toMatchObject({ enabled: true });
    expect(resolvePlanModeState({ enabled: true }, [
      stateEntry({ enabled: false, awaitingAction: false }),
    ])).toMatchObject({ enabled: false });
    expect(resolvePlanModeState({ enabled: true }, [])).toMatchObject({ enabled: true });
    expect(resolvePlanModeState(null, [])).toMatchObject({ enabled: false });
  });

  it('restores the latest plan-mode-state custom entry', () => {
    const restored = restoreSessionPlanState([
      stateEntry({ enabled: true, latestPlan: 'old' }),
      stateEntry({
        enabled: false,
        savedPlan: { plan: '# Keep this', source: 'plan_mode_complete' },
      }),
    ]);
    expect(sessionPlanFromState(restored)).toMatchObject({
      status: 'saved',
      planMarkdown: '# Keep this',
      title: 'Keep this',
    });
  });

  it('recovers a ready plan from a later plan_mode_complete tool result', () => {
    const restored = restoreSessionPlanState([
      stateEntry({ enabled: true }),
      {
        message: {
          role: 'toolResult',
          toolName: 'plan_mode_complete',
          details: { plan: '# Recovered\n\nFrom the tool.' },
        },
      },
    ]);
    expect(sessionPlanFromState(restored)).toMatchObject({
      status: 'ready',
      planMarkdown: '# Recovered\n\nFrom the tool.',
      title: 'Recovered',
    });
  });

  it('resumes a saved plan without calling /plan start', () => {
    const next = resumeSavedPlanState({
      enabled: false,
      savedPlan: { plan: '# Resume me', source: 'plan_mode_complete' },
    });
    expect(next).toMatchObject({
      enabled: true,
      latestPlan: '# Resume me',
      awaitingAction: true,
    });
    expect(next.savedPlan).toBeUndefined();
    expect(resumeSavedPlanState({ enabled: true, latestPlan: 'x' })).toBeNull();
    expect(resumeSavedPlanState({ enabled: false })).toBeNull();
  });

  it('applies mock start/save/implement/exit and blocks start while saved', () => {
    let state = applyMockPlanCommand({ enabled: false }, 'start');
    expect(sessionPlanFromState(state).status).toBe('active');

    state = applyMockPlanCommand({
      enabled: true,
      latestPlan: '# Ready',
      awaitingAction: true,
    }, 'save');
    expect(sessionPlanFromState(state).status).toBe('saved');

    expect(() => applyMockPlanCommand(state, 'start')).toThrow(/saved plan/i);

    state = applyMockPlanCommand(state, 'implement');
    expect(sessionPlanFromState(state).status).toBe('implementing');

    state = applyMockPlanCommand(state, 'exit');
    expect(sessionPlanFromState(state)).toEqual({ status: 'off', planMarkdown: '' });
  });

  it('parses plan actions and rejects unknown names', () => {
    expect(parseSessionPlanAction({ action: 'start' })).toEqual({ action: 'start' });
    expect(parseSessionPlanAction({ action: 'implement', model: 'openai/gpt-4.1' }))
      .toEqual({ action: 'implement', model: 'openai/gpt-4.1' });
    expect(() => parseSessionPlanAction({ action: 'tools' })).toThrow(/start, save, implement, exit, or resume/);
  });

  it('treats only ready/saved/implementing markdown as buildable, and shows View Plan while Plan is on', () => {
    expect(sessionPlanHasMarkdown({ status: 'active', planMarkdown: '' })).toBe(false);
    expect(sessionPlanHasMarkdown({ status: 'ready', planMarkdown: '# Plan' })).toBe(true);
    expect(sessionPlanHasMarkdown({ status: 'ready', planMarkdown: '   ' })).toBe(false);
    expect(sessionPlanViewAvailable({ status: 'active', planMarkdown: '' })).toBe(true);
    expect(sessionPlanViewAvailable({ status: 'off', planMarkdown: '' })).toBe(false);
    expect(sessionPlanViewAvailable({ status: 'ready', planMarkdown: '# Plan' })).toBe(true);
    expect(titleFromPlanMarkdown('')).toBeUndefined();
  });
});
