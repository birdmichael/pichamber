import { WALKTHROUGH_MIN_WIDTH } from '@/lib/surfaces/registry';
import { normalizeContextPanelDirectoryKey, useUIStore } from '@/stores/useUIStore';

export const MOBILE_REVIEW_MODES = ['pr', 'diff', 'walkthrough'] as const;

export type MobileReviewMode = (typeof MOBILE_REVIEW_MODES)[number];

export type MobileReviewPanelState = {
  isOpen: boolean;
  activeTabId: string | null;
  tabs: readonly { id: string; mode: string }[];
} | null | undefined;

/**
 * Desktop Git opens the PR surface with `openContextSurface(dir, 'pr')`.
 * Mobile Git uses that same action and hosts `PullRequestView`.
 */
export const MOBILE_GIT_PR_SURFACE_MODE = 'pr' as const satisfies MobileReviewMode;

/**
 * Desktop Git opens a file with `openContextDiff`. Mobile Git uses that same
 * action and hosts `DiffView` — not a second diff stack.
 */
export const MOBILE_GIT_DIFF_SURFACE_MODE = 'diff' as const satisfies MobileReviewMode;

/**
 * Walkthrough stays tablet-only. The Desktop rail already hides it below
 * `WALKTHROUGH_MIN_WIDTH` because a stop list beside real code is the surface.
 * A stacked phone flow would be a second Walkthrough; reuse the existing gate.
 */
export const isMobileWalkthroughAvailable = (screenWidth: number): boolean => (
  Number.isFinite(screenWidth) && screenWidth >= WALKTHROUGH_MIN_WIDTH
);

/**
 * Mobile WebView cannot offer the Electron Chromium session
 * (`persist:openchamber-browser`). There is no reduced honest browser surface.
 */
export const isMobileBrowserSupported = (): false => false;

export const isMobileReviewMode = (mode: string | null | undefined): mode is MobileReviewMode => (
  mode === 'pr' || mode === 'diff' || mode === 'walkthrough'
);

export const resolveMobileReviewMode = (
  panel: MobileReviewPanelState,
  screenWidth: number,
): MobileReviewMode | null => {
  if (!panel?.isOpen) {
    return null;
  }
  const active = panel.tabs.find((tab) => tab.id === panel.activeTabId);
  if (!active || !isMobileReviewMode(active.mode)) {
    return null;
  }
  if (active.mode === 'walkthrough' && !isMobileWalkthroughAvailable(screenWidth)) {
    return null;
  }
  return active.mode;
};

/** Close an open PR / Diff / Walkthrough overlay. Returns whether one was open. */
export const closeMobileReviewOverlay = (
  directory: string | null | undefined,
  screenWidth: number,
): boolean => {
  const trimmed = (directory || '').trim();
  if (!trimmed) {
    return false;
  }
  const key = normalizeContextPanelDirectoryKey(trimmed);
  const panel = useUIStore.getState().contextPanelByDirectory[key];
  if (!resolveMobileReviewMode(panel, screenWidth)) {
    return false;
  }
  useUIStore.getState().closeContextPanel(key);
  return true;
};
