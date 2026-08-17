import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { WorkStatusPresenceProvider } from '@/components/chat/work-status/presence';
import { computeContextUsage } from '@/components/chat/work-status/contextUsage';
import { getWorkStatusPanelPresentation } from '@/components/chat/work-status/sections';
import { WorkStatusSections } from '@/components/chat/work-status/WorkStatusSections';
import { useWorkStatusSectionVisibility } from '@/components/chat/work-status/useWorkStatusSectionVisibility';
import { WorkStatusSectionsDialog } from '@/components/chat/work-status/WorkStatusSectionsDialog';
import { useTabletLayout } from '@/lib/device';
import { useI18n } from '@/lib/i18n';
import { clampPercent, resolveUsageTone } from '@/lib/quota';
import { cn } from '@/lib/utils';
import { useConfigStore } from '@/stores/useConfigStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSessionMessages } from '@/sync/sync-context';

import { MOBILE_WORK_STATUS_HOST } from './mobileWorkStatusHost';

const TABLET_METADATA_POPOVER_WIDTH = 380;

const ContextProgressIcon: React.FC<{ percentage: number }> = ({ percentage }) => {
  const progressPct = clampPercent(percentage) ?? 0;
  const tone = resolveUsageTone(percentage);
  const progressColor = tone === 'critical'
    ? 'var(--status-error)'
    : tone === 'warn'
      ? 'var(--status-warning)'
      : 'var(--status-success)';
  const size = 18;
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="size-[18px] -rotate-90"
      role="progressbar"
      aria-valuenow={Math.round(progressPct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--interactive-border)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={progressColor}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progressPct / 100)}
        className="transition-[stroke-dashoffset,stroke] duration-300"
      />
    </svg>
  );
};

const SessionMetadataOverlay: React.FC<{
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  sessionId: string | null;
  directory: string | null;
}> = ({ open, onClose, anchorRef, sessionId, directory }) => {
  const { t } = useI18n();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = React.useState(open);
  const [isExiting, setIsExiting] = React.useState(false);
  const [sectionsDialogOpen, setSectionsDialogOpen] = React.useState(false);
  const [renderedSections, setRenderedSections] = React.useState(1);
  const { allSectionsHidden } = useWorkStatusSectionVisibility();
  const { showEmptyState } = getWorkStatusPanelPresentation({
    visible: open,
    contentMounted: shouldRender,
    renderedSections,
    allSectionsHidden,
  });
  // Tablet: a phone-width sheet stretched across the whole chat column looks
  // broken — render a popover anchored to the metadata button instead.
  const { enabled: isTabletLayout } = useTabletLayout();
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const [anchorLeft, setIpadAnchorLeft] = React.useState<number | null>(null);

  // The shell has transformed ancestors, so the fixed wrapper's containing
  // block is the chat column, NOT the viewport. Anchor the popover in the
  // wrapper's own coordinate space — viewport-based lefts would double-count
  // the sidebar offset.
  React.useLayoutEffect(() => {
    if (!open || !isTabletLayout || !shouldRender) return;
    const compute = () => {
      const anchorRect = anchorRef.current?.getBoundingClientRect();
      const wrapperRect = wrapperRef.current?.getBoundingClientRect();
      if (!anchorRect || !wrapperRect) {
        setIpadAnchorLeft(null);
        return;
      }
      const relativeLeft = anchorRect.left - wrapperRect.left;
      const left = Math.min(
        Math.max(relativeLeft, 8),
        Math.max(8, wrapperRect.width - TABLET_METADATA_POPOVER_WIDTH - 8),
      );
      setIpadAnchorLeft(left);
    };
    compute();
    // Re-anchor if the chat column shifts while the popover is open (sidebar
    // toggle/resize, orientation change) — the header buttons move with it.
    const wrapper = wrapperRef.current;
    if (typeof ResizeObserver === 'undefined' || !wrapper) return;
    const observer = new ResizeObserver(compute);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [anchorRef, isTabletLayout, open, shouldRender]);

  const isPopover = isTabletLayout && anchorLeft !== null;

  React.useEffect(() => {
    if (open) {
      setShouldRender(true);
      setIsExiting(false);
      return;
    }

    if (!shouldRender) return;
    setIsExiting(true);
    const timeoutId = window.setTimeout(() => {
      setShouldRender(false);
      setIsExiting(false);
    }, 140);
    return () => window.clearTimeout(timeoutId);
  }, [open, shouldRender]);

  React.useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, open]);

  React.useEffect(() => {
    if (!open) return;

    const closeIfOutside = (event: PointerEvent | WheelEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        onClose();
        return;
      }
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };

    document.addEventListener('pointerdown', closeIfOutside, true);
    document.addEventListener('wheel', closeIfOutside, true);
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside, true);
      document.removeEventListener('wheel', closeIfOutside, true);
    };
  }, [anchorRef, onClose, open]);

  if (!shouldRender) return null;

  return (
    <div ref={wrapperRef} className="fixed inset-x-0 bottom-0 top-[calc(var(--oc-safe-area-top,0px)+var(--oc-header-height,56px))] z-20 pointer-events-none">
      <div
        ref={panelRef}
        role="dialog"
        aria-label={t('chat.workStatus.ariaLabel')}
        data-work-status-host={MOBILE_WORK_STATUS_HOST}
        className={cn(
          'relative overflow-y-auto overscroll-contain rounded-[20px] border border-border/70 bg-[var(--surface-elevated)] p-2 shadow-[0_12px_32px_rgb(0_0_0_/_0.2)] will-change-transform',
          isPopover ? 'absolute origin-top-left' : 'mx-3 mt-2',
          isExiting ? 'pointer-events-none' : 'pointer-events-auto',
        )}
        style={{
          animation: `${isExiting ? 'session-metadata-out' : 'session-metadata-in'} ${isExiting ? 140 : 170}ms cubic-bezier(0.32, 0.72, 0, 1) forwards`,
          maxHeight: 'min(72dvh, calc(100dvh - var(--oc-safe-area-top, 0px) - var(--oc-header-height, 56px) - 1rem))',
          ...(isPopover
            ? {
                top: 8,
                left: anchorLeft ?? 8,
                width: `min(${TABLET_METADATA_POPOVER_WIDTH}px, calc(100% - 16px))`,
              }
            : null),
        }}
      >
        <button
          type="button"
          aria-label={t('chat.workStatus.sections.open')}
          onClick={() => setSectionsDialogOpen(true)}
          className="absolute right-2 top-1.5 z-10 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icon name="equalizer-2" className="size-4" />
        </button>
        <WorkStatusPresenceProvider onChange={setRenderedSections}>
          <WorkStatusSections sessionId={sessionId} directory={directory} />
        </WorkStatusPresenceProvider>
        {showEmptyState ? (
          <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
            <span className="text-sm text-muted-foreground">{t('chat.workStatus.sections.allHidden')}</span>
            <Button
              variant="link"
              size="xs"
              onClick={() => setSectionsDialogOpen(true)}
              className="mt-2 normal-case text-muted-foreground hover:text-foreground"
            >
              {t('chat.workStatus.sections.open')}
            </Button>
          </div>
        ) : null}
        <WorkStatusSectionsDialog open={sectionsDialogOpen} onOpenChange={setSectionsDialogOpen} />
      </div>
      <style>{`
        @keyframes session-metadata-in {
          from { opacity: 0; transform: translateY(-8px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes session-metadata-out {
          from { opacity: 1; transform: translateY(0) scale(1); }
          to { opacity: 0; transform: translateY(-6px) scale(0.985); }
        }
      `}</style>
    </div>
  );
};

export const MobileSessionMetadataButton = React.memo(function MobileSessionMetadataButton({
  open,
  onOpenChange,
  currentSessionId,
  effectiveDirectory,
  isNewSessionDraftOpen,
}: {
  open: boolean;
  onOpenChange: (open: boolean | ((open: boolean) => boolean)) => void;
  currentSessionId: string | null;
  effectiveDirectory: string | null;
  isNewSessionDraftOpen: boolean;
}) {
  const { t } = useI18n();
  const metadataTriggerRef = React.useRef<HTMLButtonElement>(null);
  const newSessionDraft = useSessionUIStore((state) => state.newSessionDraft);
  const workStatusDirectory = (newSessionDraft?.open
    ? newSessionDraft.bootstrapPendingDirectory ?? newSessionDraft.directoryOverride ?? effectiveDirectory
    : effectiveDirectory) ?? null;
  const workStatusSessionId = newSessionDraft?.open ? null : currentSessionId;
  const sessionMessages = useSessionMessages(workStatusSessionId ?? '', workStatusDirectory || undefined);
  const getCurrentModel = useConfigStore((state) => state.getCurrentModel);
  const currentProviderId = useConfigStore((state) => state.currentProviderId);
  const currentModelId = useConfigStore((state) => state.currentModelId);
  const contextLimit = React.useMemo(() => {
    const currentModel = getCurrentModel();
    const limit = currentModel && typeof currentModel.limit === 'object' && currentModel.limit !== null
      ? (currentModel.limit as Record<string, unknown>)
      : null;
    return limit && typeof limit.context === 'number' ? limit.context : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getter output tracks the selected model ids
  }, [getCurrentModel, currentProviderId, currentModelId]);
  const contextUsage = React.useMemo(
    () => (isNewSessionDraftOpen ? null : computeContextUsage(sessionMessages, contextLimit)),
    [contextLimit, isNewSessionDraftOpen, sessionMessages],
  );

  return (
    <>
      <button
        ref={metadataTriggerRef}
        type="button"
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={t('chat.workStatus.ariaLabel')}
        aria-expanded={open}
        onClick={() => onOpenChange((currentOpen) => !currentOpen)}
        style={{ touchAction: 'manipulation' }}
      >
        {/* Live context gauge doubles as the Work Status trigger: filled by the
            session's context usage, an empty ring on a fresh draft. */}
        <ContextProgressIcon percentage={contextUsage?.percent ?? 0} />
      </button>
      <SessionMetadataOverlay
        open={open}
        onClose={() => onOpenChange(false)}
        anchorRef={metadataTriggerRef}
        sessionId={workStatusSessionId}
        directory={workStatusDirectory}
      />
    </>
  );
});
