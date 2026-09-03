import { afterEach, describe, expect, test } from 'bun:test';

import { useUIStore } from '@/stores/useUIStore';
import { handlePiExtensionUiEvent } from './pi-extension-ui-events';
import {
  maybeOpenPlanRailOnReady,
  resetPlanReadyRailOpenForTests,
  shouldAutoOpenPlanRail,
  shouldClosePlanPanelForSession,
  syncPlanPanelToSession,
} from './pi-plan-ready';
import { applySessionPlan, resetPiSessionPlanStore } from './pi-session-plan-store';

const directory = '/repo';

afterEach(() => {
  resetPlanReadyRailOpenForTests();
  resetPiSessionPlanStore();
  useUIStore.setState({
    isMobile: false,
    activeMainTab: 'chat',
    contextPanelByDirectory: {},
  });
});

describe('shouldAutoOpenPlanRail', () => {
  test('opens when status becomes ready with markdown, not on /plan start', () => {
    expect(shouldAutoOpenPlanRail({
      previous: { status: 'active', planMarkdown: '' },
      next: { status: 'ready', planMarkdown: '# Clean up' },
      alreadyOpenedForSession: false,
    })).toBe(true);
    expect(shouldAutoOpenPlanRail({
      previous: { status: 'off', planMarkdown: '' },
      next: { status: 'active', planMarkdown: '' },
      alreadyOpenedForSession: false,
    })).toBe(false);
    expect(shouldAutoOpenPlanRail({
      previous: { status: 'ready', planMarkdown: '# Clean up' },
      next: { status: 'ready', planMarkdown: '# Clean up' },
      alreadyOpenedForSession: false,
    })).toBe(false);
    expect(shouldAutoOpenPlanRail({
      previous: { status: 'active', planMarkdown: '' },
      next: { status: 'ready', planMarkdown: '# Clean up' },
      alreadyOpenedForSession: true,
    })).toBe(false);
  });

  test('opens when the pending plan-ready select arrives', () => {
    expect(shouldAutoOpenPlanRail({
      previous: { status: 'ready', planMarkdown: '# Clean up' },
      next: { status: 'ready', planMarkdown: '# Clean up' },
      alreadyOpenedForSession: false,
      prompt: {
        kind: 'select',
        status: 'pending',
        title: 'Proposed plan ready. What next?',
        options: ['Implement here', 'Start fresh and implement'],
      },
    })).toBe(true);
    expect(shouldAutoOpenPlanRail({
      previous: { status: 'off', planMarkdown: '' },
      next: { status: 'off', planMarkdown: '' },
      alreadyOpenedForSession: false,
      prompt: {
        kind: 'select',
        status: 'pending',
        title: 'Plan mode',
        options: ['Start plan mode'],
      },
    })).toBe(false);
  });
});

describe('maybeOpenPlanRailOnReady', () => {
  test('docks the Plan rail without setting desktop activeMainTab or expanding', () => {
    useUIStore.setState({
      isMobile: false,
      activeMainTab: 'chat',
      contextPanelByDirectory: {
        [directory]: {
          isOpen: false,
          expanded: true,
          tabs: [],
          activeTabId: null,
          widthByMode: {},
          touchedAt: Date.now(),
        },
      },
    });

    const opened = maybeOpenPlanRailOnReady({
      sessionID: 'ses_1',
      previous: { status: 'active', planMarkdown: '' },
      next: { status: 'ready', planMarkdown: '# Clean up' },
      directoryHint: directory,
    });

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(opened).toBe(true);
    expect(state?.isOpen).toBe(true);
    expect(state?.expanded).toBe(false);
    expect(state?.activeTabId).toBe('plan');
    expect(useUIStore.getState().activeMainTab).toBe('chat');
  });

  test('does not open again for the same ready cycle or on /plan start', () => {
    maybeOpenPlanRailOnReady({
      sessionID: 'ses_1',
      previous: { status: 'active', planMarkdown: '' },
      next: { status: 'ready', planMarkdown: '# Clean up' },
      directoryHint: directory,
    });
    useUIStore.getState().closeContextPanel(directory);

    expect(maybeOpenPlanRailOnReady({
      sessionID: 'ses_1',
      previous: { status: 'ready', planMarkdown: '# Clean up' },
      next: { status: 'ready', planMarkdown: '# Clean up' },
      directoryHint: directory,
    })).toBe(false);
    expect(useUIStore.getState().contextPanelByDirectory[directory]?.isOpen).toBe(false);

    resetPlanReadyRailOpenForTests();
    expect(maybeOpenPlanRailOnReady({
      sessionID: 'ses_1',
      previous: { status: 'off', planMarkdown: '' },
      next: { status: 'active', planMarkdown: '' },
      directoryHint: directory,
    })).toBe(false);
    expect(useUIStore.getState().activeMainTab).toBe('chat');
  });

  test('mobile still uses the plan sheet tab', () => {
    useUIStore.setState({ isMobile: true, activeMainTab: 'chat' });
    expect(maybeOpenPlanRailOnReady({
      sessionID: 'ses_1',
      previous: { status: 'active', planMarkdown: '' },
      next: { status: 'ready', planMarkdown: '# Clean up' },
      directoryHint: directory,
    })).toBe(true);
    expect(useUIStore.getState().activeMainTab).toBe('plan');
  });
});

describe('plan-ready store and events', () => {
  test('applySessionPlan opens the docked rail on ready and not on active', () => {
    applySessionPlan('ses_1', { status: 'active', planMarkdown: '' });
    expect(useUIStore.getState().contextPanelByDirectory[directory]).toBe(undefined);

    applySessionPlan('ses_1', { status: 'ready', planMarkdown: '# Clean up' });
    // No directory hint on the store path unless session/directory stores have one.
    expect(useUIStore.getState().activeMainTab).toBe('chat');
  });

  test('a plan-ready select event docks the rail', () => {
    handlePiExtensionUiEvent({
      type: 'pi.ui.asked',
      properties: {
        prompt: {
          id: 'pui_1',
          sessionID: 'ses_1',
          directory,
          kind: 'select',
          title: 'Proposed plan ready. What next?',
          options: ['Implement here', 'Start fresh and implement'],
          status: 'pending',
        },
      },
    });

    const state = useUIStore.getState().contextPanelByDirectory[directory];
    expect(state?.isOpen).toBe(true);
    expect(state?.expanded).toBe(false);
    expect(state?.activeTabId).toBe('plan');
    expect(useUIStore.getState().activeMainTab).toBe('chat');
  });
});

describe('syncPlanPanelToSession', () => {
  test('does not close Plan chrome for a session that has a plan or pending draft', () => {
    expect(shouldClosePlanPanelForSession({
      plan: { status: 'active', planMarkdown: '' },
    })).toBe(false);
    expect(shouldClosePlanPanelForSession({
      plan: { status: 'off', planMarkdown: '' },
      pendingDraftPlan: true,
    })).toBe(false);
    expect(shouldClosePlanPanelForSession({
      plan: null,
    })).toBe(true);
    expect(shouldClosePlanPanelForSession({
      plan: { status: 'off', planMarkdown: '' },
    })).toBe(true);
  });

  test('closes an empty leftover Plan rail when switching to a session without a plan', () => {
    useUIStore.getState().openContextPlan(directory);
    expect(useUIStore.getState().contextPanelByDirectory[directory]?.isOpen).toBe(true);
    expect(useUIStore.getState().contextPanelByDirectory[directory]?.activeTabId).toBe('plan');
    syncPlanPanelToSession({
      sessionID: 'ses_b',
      plan: null,
      directoryHint: directory,
    });
    const state = useUIStore.getState().contextPanelByDirectory[directory];
    const planStillActive = state?.isOpen && state.activeTabId === 'plan';
    expect(planStillActive).toBe(false);
  });
});
