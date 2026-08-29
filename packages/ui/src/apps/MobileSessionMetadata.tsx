import React from 'react';

import { computeContextUsage } from '@/components/chat/work-status/contextUsage';
import {
  isWorkStatusDismissExemptTarget,
  shouldCloseWorkStatusSheetOnNavigate,
} from '@/components/chat/work-status/workStatusDismiss';
import { isChatDirectoryPath } from '@/lib/chatDirectories';
import { useTabletLayout } from '@/lib/device';
import { useI18n } from '@/lib/i18n';
import { clampPercent, resolveUsageTone } from '@/lib/quota';
import { cn } from '@/lib/utils';
import { useConfigStore } from '@/stores/useConfigStore';
import { normalizeContextPanelDirectoryKey, useUIStore } from '@/stores/useUIStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSessionMessages } from '@/sync/sync-context';

import { MobileWorkStatusHost } from './MobileWorkStatusHost';

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
  repositoryEnabled?: boolean;
}> = ({ open, onClose, anchorRef, sessionId, directory, repositoryEnabled = true }) => {
  const { t } = useI18n();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [sectionsDialogOpen, setSectionsDialogOpen] = React.useState(false);
  const [shouldRender, setShouldRender] = React.useState(open);
  const [isExiting, setIsExiting] = React.useState(false);
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
    setSectionsDialogOpen(false);

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
      if (isWorkStatusDismissExemptTarget(target, { sectionsDialogOpen })) return;
      onClose();
    };

    document.addEventListener('pointerdown', closeIfOutside, true);
    document.addEventListener('wheel', closeIfOutside, true);
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside, true);
      document.removeEventListener('wheel', closeIfOutside, true);
    };
  }, [anchorRef, onClose, open, sectionsDialogOpen]);

  // Row Open writes Desktop context-panel state or setCurrentSession. Close
  // the sheet so those destinations are not covered by pointer-events-auto.
  React.useEffect(() => {
    if (!open) return;
    const sessionIdWhenOpened = useSessionUIStore.getState().currentSessionId;
    const directoryKey = directory ? normalizeContextPanelDirectoryKey(directory) : '';
    const panelWasOpen = Boolean(
      directoryKey && useUIStore.getState().contextPanelByDirectory[directoryKey]?.isOpen,
    );
    const maybeClose = () => {
      const panelIsOpen = Boolean(
        directoryKey && useUIStore.getState().contextPanelByDirectory[directoryKey]?.isOpen,
      );
      if (shouldCloseWorkStatusSheetOnNavigate({
        sessionIdWhenOpened,
        currentSessionId: useSessionUIStore.getState().currentSessionId,
        panelWasOpen,
        panelIsOpen,
      })) {
        onClose();
      }
    };
    const unsubUI = useUIStore.subscribe(maybeClose);
    const unsubSession = useSessionUIStore.subscribe(maybeClose);
    const onHash = () => onClose();
    window.addEventListener('hashchange', onHash);
    return () => {
      unsubUI();
      unsubSession();
      window.removeEventListener('hashchange', onHash);
    };
  }, [directory, onClose, open]);

  if (!shouldRender) return null;

  return (
    <div ref={wrapperRef} className="fixed inset-x-0 bottom-0 top-[calc(var(--oc-safe-area-top,0px)+var(--oc-header-height,56px))] z-20 pointer-events-none">
      <div
        ref={panelRef}
        role="dialog"
        aria-label={t('chat.workStatus.ariaLabel')}
        className={cn(
          'relative flex min-h-0 flex-col overflow-hidden overscroll-contain rounded-[20px] border border-border/70 bg-[var(--surface-elevated)] shadow-[0_12px_32px_rgb(0_0_0_/_0.2)] will-change-transform',
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
        <MobileWorkStatusHost
          sessionId={sessionId}
          directory={directory}
          repositoryEnabled={repositoryEnabled}
          onSectionsDialogOpenChange={setSectionsDialogOpen}
          onNavigate={onClose}
        />
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
  const isManagedChatContext = newSessionDraft?.open
    ? newSessionDraft.target === 'chat'
    : isChatDirectoryPath(effectiveDirectory);
  const workStatusDirectory = (newSessionDraft?.open
    ? (isManagedChatContext ? null : newSessionDraft.bootstrapPendingDirectory ?? newSessionDraft.directoryOverride ?? effectiveDirectory)
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
        repositoryEnabled={!isManagedChatContext}
      />
    </>
  );
});
