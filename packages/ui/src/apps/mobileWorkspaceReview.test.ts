import { beforeEach, describe, expect, test } from 'bun:test';

import { WALKTHROUGH_MIN_WIDTH } from '@/lib/surfaces/registry';
import { useUIStore } from '@/stores/useUIStore';

import { listVisibleMobileWorkspaceTabs, MOBILE_WORKSPACE_ALWAYS_TABS } from './mobileWorkspaceTabs';
import {
  closeMobileReviewOverlay,
  isMobileBrowserSupported,
  isMobileWalkthroughAvailable,
  MOBILE_GIT_DIFF_SURFACE_MODE,
  MOBILE_GIT_PR_SURFACE_MODE,
  resolveMobileReviewMode,
} from './mobileWorkspaceReview';

const pluginsOff = {
  isPiKernel: true,
  featurePlugins: null,
  plan: { status: 'off' as const, planMarkdown: '' },
  planModeExperimentalEnabled: false,
};

beforeEach(() => {
  useUIStore.setState({ contextPanelByDirectory: {}, contextRailOrder: [] });
});

describe('mobile Phase 2 review from Git', () => {
  test('opens PR and Diff through the same Desktop context-panel actions', () => {
    const directory = '/repo';

    expect(MOBILE_GIT_PR_SURFACE_MODE).toBe('pr');
    expect(MOBILE_GIT_DIFF_SURFACE_MODE).toBe('diff');

    useUIStore.getState().openContextSurface(directory, MOBILE_GIT_PR_SURFACE_MODE);
    const afterPr = useUIStore.getState().contextPanelByDirectory[directory];
    expect(afterPr?.isOpen).toBe(true);
    expect(afterPr?.tabs.map((tab) => tab.mode)).toEqual(['pr']);
    expect(resolveMobileReviewMode(afterPr, 390)).toBe('pr');

    useUIStore.getState().openContextDiff(directory, 'src/app.ts', false);
    const afterDiff = useUIStore.getState().contextPanelByDirectory[directory];
    expect(afterDiff?.tabs.some((tab) => tab.mode === 'diff')).toBe(true);
    expect(afterDiff?.tabs.find((tab) => tab.id === afterDiff.activeTabId)?.mode).toBe('diff');
    expect(resolveMobileReviewMode(afterDiff, 390)).toBe('diff');
  });

  test('opens PR on an empty repo and on a repo that already has a PR tab', () => {
    const empty = '/empty-repo';
    useUIStore.getState().openContextSurface(empty, 'pr');
    expect(resolveMobileReviewMode(useUIStore.getState().contextPanelByDirectory[empty], 390)).toBe('pr');

    const withPr = '/repo-with-pr';
    useUIStore.getState().openContextPanelTab(withPr, { mode: 'pr' });
    expect(resolveMobileReviewMode(useUIStore.getState().contextPanelByDirectory[withPr], 390)).toBe('pr');
  });

  test('opening Diff on a clean repo still hosts the Desktop diff surface', () => {
    const directory = '/clean-repo';
    useUIStore.getState().openContextDiff(directory, 'README.md', false);
    const panel = useUIStore.getState().contextPanelByDirectory[directory];
    expect(panel?.isOpen).toBe(true);
    expect(resolveMobileReviewMode(panel, 390)).toBe('diff');
  });

  test('Walkthrough is tablet-only at WALKTHROUGH_MIN_WIDTH', () => {
    expect(isMobileWalkthroughAvailable(WALKTHROUGH_MIN_WIDTH - 1)).toBe(false);
    expect(isMobileWalkthroughAvailable(WALKTHROUGH_MIN_WIDTH)).toBe(true);

    const directory = '/repo';
    useUIStore.getState().openContextSurface(directory, 'walkthrough');
    const panel = useUIStore.getState().contextPanelByDirectory[directory];
    expect(resolveMobileReviewMode(panel, WALKTHROUGH_MIN_WIDTH - 1)).toBe(null);
    expect(resolveMobileReviewMode(panel, WALKTHROUGH_MIN_WIDTH)).toBe('walkthrough');
  });

  test('switching directories does not keep the previous session PR overlay', () => {
    useUIStore.getState().openContextSurface('/session-a', 'pr');
    expect(resolveMobileReviewMode(useUIStore.getState().contextPanelByDirectory['/session-a'], 390)).toBe('pr');
    expect(resolveMobileReviewMode(useUIStore.getState().contextPanelByDirectory['/session-b'], 390)).toBe(null);

    expect(closeMobileReviewOverlay('/session-a', 390)).toBe(true);
    expect(useUIStore.getState().contextPanelByDirectory['/session-a']?.isOpen).toBe(false);
    expect(closeMobileReviewOverlay('/session-b', 390)).toBe(false);
  });

  test('does not add a Browser tab on mobile', () => {
    expect(isMobileBrowserSupported()).toBe(false);
    expect(listVisibleMobileWorkspaceTabs(pluginsOff)).toEqual([...MOBILE_WORKSPACE_ALWAYS_TABS]);
    expect(listVisibleMobileWorkspaceTabs(pluginsOff).includes('browser' as never)).toBe(false);
    expect(MOBILE_WORKSPACE_ALWAYS_TABS.includes('browser' as never)).toBe(false);
  });
});
