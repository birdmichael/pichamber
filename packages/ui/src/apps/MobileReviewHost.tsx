import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { PullRequestView } from '@/components/views/PullRequestView';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { lazyWithChunkRecovery } from '@/lib/chunkLoadRecovery';
import { useDeviceInfo } from '@/lib/device';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  normalizeContextPanelDirectoryKey,
  type PendingDiffScope,
  useUIStore,
} from '@/stores/useUIStore';
import { useSessionUIStore } from '@/sync/session-ui-store';

import {
  closeMobileReviewOverlay,
  resolveMobileReviewMode,
  type MobileReviewMode,
} from './mobileWorkspaceReview';

const DiffView = lazyWithChunkRecovery(() => import('@/components/views/DiffView').then((m) => ({ default: m.DiffView })));
const WalkthroughView = lazyWithChunkRecovery(() => import('@/components/views/walkthrough/WalkthroughView').then((m) => ({ default: m.WalkthroughView })));

const REVIEW_TITLE_KEY: Record<MobileReviewMode, I18nKey> = {
  pr: 'contextPanel.mode.pr',
  diff: 'contextPanel.mode.diff',
  walkthrough: 'contextPanel.mode.walkthrough',
};

/**
 * Touch host for Desktop PR / tablet Diff / Walkthrough. Git opens PR with
 * `openContextSurface`. Phone file rows stay on `MobileDiffDetail`; tablet
 * width uses `openContextDiff` so the Diff toolbar Walkthrough can appear.
 * Walkthrough stays hidden below `WALKTHROUGH_MIN_WIDTH`.
 */
export const MobileReviewHost: React.FC = () => {
  const { t } = useI18n();
  const { screenWidth } = useDeviceInfo();
  const directory = useEffectiveDirectory() ?? null;
  const directoryKey = directory ? normalizeContextPanelDirectoryKey(directory) : '';
  const sessionId = useSessionUIStore((state) => state.currentSessionId);
  const panel = useUIStore((state) => (
    directoryKey ? state.contextPanelByDirectory[directoryKey] : undefined
  ));
  const closeContextPanel = useUIStore((state) => state.closeContextPanel);
  const openContextPanelTab = useUIStore((state) => state.openContextPanelTab);
  const mode = resolveMobileReviewMode(panel, screenWidth);
  const activeTab = panel?.tabs.find((tab) => tab.id === panel.activeTabId) ?? null;

  const previousSessionRef = React.useRef({ sessionId, directoryKey });
  React.useEffect(() => {
    const previous = previousSessionRef.current;
    previousSessionRef.current = { sessionId, directoryKey };
    if (previous.sessionId === sessionId) {
      return;
    }
    if (previous.directoryKey) {
      closeMobileReviewOverlay(previous.directoryKey, screenWidth);
    }
  }, [directoryKey, screenWidth, sessionId]);

  const handleDiffScopeChange = React.useCallback((nextScope: PendingDiffScope) => {
    if (!directoryKey || activeTab?.mode !== 'diff') {
      return;
    }
    openContextPanelTab(directoryKey, {
      mode: 'diff',
      targetPath: activeTab.targetPath,
      stagedDiff: nextScope === 'staged',
      diffScope: nextScope,
    });
  }, [activeTab, directoryKey, openContextPanelTab]);

  const handleBack = React.useCallback(() => {
    if (directoryKey) {
      closeContextPanel(directoryKey);
    }
  }, [closeContextPanel, directoryKey]);

  if (!mode || !directoryKey) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-background text-foreground">
      <header className="flex h-[var(--oc-header-height,56px)] shrink-0 items-center gap-2 px-3">
        <button
          type="button"
          className="-ml-1 flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={t('header.actions.backAria')}
          onClick={handleBack}
          style={{ touchAction: 'manipulation' }}
        >
          <Icon name="arrow-left" className="size-5" />
        </button>
        <h2 className="min-w-0 flex-1 truncate typography-ui-label text-foreground">
          {t(REVIEW_TITLE_KEY[mode])}
        </h2>
      </header>
      <div className={cn('min-h-0 flex-1 overflow-hidden')}>
        <ErrorBoundary>
          {mode === 'pr' ? <PullRequestView /> : null}
          {mode === 'diff' ? (
            <React.Suspense fallback={null}>
              <DiffView
                hideStackedFileSidebar
                stackedDefaultCollapsedAll
                pinSelectedFileHeaderToTopOnNavigate
                diffScope={activeTab?.diffScope ?? (activeTab?.stagedDiff ? 'staged' : 'working')}
                onDiffScopeChange={handleDiffScopeChange}
                targetFilePath={activeTab?.targetPath}
                flushContent
              />
            </React.Suspense>
          ) : null}
          {mode === 'walkthrough' ? (
            <React.Suspense fallback={null}>
              <WalkthroughView directory={directoryKey} />
            </React.Suspense>
          ) : null}
        </ErrorBoundary>
      </div>
    </div>
  );
};
