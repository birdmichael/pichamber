import React from 'react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/useUIStore';
import { WORK_STATUS_PANEL_WIDTH } from './useWorkStatusVisibility';
import { PARENT_CHAT_MIN_WIDTH } from '@/lib/surfaces/chatColumnLayout';
import { WorkStatusContents } from './WorkStatusContents';
import {
  getWorkStatusPanelPresentation,
} from './sections';
import { useWorkStatusSectionVisibility } from './useWorkStatusSectionVisibility';
import { isWorkStatusDismissExemptTarget } from './workStatusDismiss';

type Props = {
  /** Null on a new-session draft: repository readouts still apply. */
  sessionId: string | null;
  directory: string | null;
  /** Managed Chats have no project repository, even if another project remains active. */
  repositoryEnabled?: boolean;
  /** Whether the panel should currently occupy space. */
  visible: boolean;
  /**
   * Floats over the transcript instead of sitting beside it, for when the chat
   * is too narrow to give it a column of its own.
   */
  overlay?: boolean;
};

/**
 * Matches the context panel's own width animation exactly.
 *
 * Both sit beside the transcript. Shrinking this card and the context panel
 * on the same curve keeps the parent column from jumping when a child tab
 * opens.
 */
const PANEL_TRANSITION_MS = 200;
const PANEL_TRANSITION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * Work-status panel: a card inside the chat column reporting the state of the
 * session, its branch and its subagents.
 *
 * Tasks is first when that section is available. Remaining sections still
 * group durable session/project readouts, then work in flight, then episodic
 * material. Each section renders nothing when it has nothing, so the panel
 * collapses toward the top instead of reserving empty space.
 *
 * The card clips; the scroller lives inside it, so the same top/bottom scroll
 * shadows the transcript uses stay within the rounded border instead of
 * bleeding past it. The scrollbar itself is hidden — at this width it would
 * eat a visible slice of every row's trailing value, and the shadows already
 * say there is more to see.
 */
export const WorkStatusPanel: React.FC<Props> = ({ sessionId, directory, visible, repositoryEnabled = true, overlay = false }) => {
  const { t } = useI18n();
  const setScrollTop = useUIStore((state) => state.setWorkStatusScrollTop);
  const setOverlayOpen = useUIStore((state) => state.setWorkStatusOverlayOpen);
  const { allSectionsHidden } = useWorkStatusSectionVisibility();
  // Starts optimistic: sections report after their first commit, and rendering
  // nothing on the way in would make the card flash out and back on arrival.
  const [renderedSections, setRenderedSections] = React.useState(1);
  const frameRef = React.useRef<number | null>(null);

  // Restoring the offset has to happen the moment the scroller attaches, and
  // the panel unmounts whenever the context panel opens. Reading the stored
  // value through a ref keeps this a mount-time restore rather than a
  // subscription that would fight the user mid-scroll.
  // Content is dropped only after the collapse finishes, so the card animates
  // out with something in it rather than emptying first, and its subscriptions
  // stop once it is truly gone.
  const [contentMounted, setContentMounted] = React.useState(visible);
  // Hidden or mid-collapse: the card is not something the user can act on.
  // When `visible` but all sections are hidden, the panel stays interactive so
  // the settings button remains reachable — otherwise there is no way to
  // re-enable sections. The previous `renderedSections > 0` guard is preserved
  // for the transient "no data yet" state so the panel doesn't flash a bare
  // bordered card on first mount.
  const { interactive } = getWorkStatusPanelPresentation({
    visible,
    contentMounted,
    renderedSections,
    allSectionsHidden,
  });
  React.useEffect(() => {
    if (visible) {
      setContentMounted(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setContentMounted(false), PANEL_TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [visible]);

  const restore = React.useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const stored = useUIStore.getState().workStatusScrollTop;
    if (stored > 0) node.scrollTop = stored;
  }, []);

  // Coalesced to one write per frame: scroll fires far faster than the store
  // needs to hear about it.
  const handleScroll = React.useCallback((event: React.UIEvent<HTMLElement>) => {
    const { scrollTop } = event.currentTarget;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setScrollTop(scrollTop);
    });
  }, [setScrollTop]);

  React.useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  // The offset belongs to the panel a session produced, not to the panel in
  // general: restoring one session's scroll into another's shorter panel lands
  // somewhere arbitrary.
  React.useEffect(() => {
    setScrollTop(0);
  }, [sessionId, setScrollTop]);

  // Dismissed like any transient surface: a click elsewhere or Escape. It
  // covers the transcript, so leaving it up would block the thing it reports on.
  const overlayRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    // Only while it is actually up: a hidden overlay listening for clicks would
    // swallow the very press that opens it.
    if (!overlay || !visible) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (overlayRef.current?.contains(target)) return;
      // Sections / Goal dialogs portal to document.body.
      if (isWorkStatusDismissExemptTarget(target)) return;
      setOverlayOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOverlayOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [overlay, setOverlayOpen, visible]);

  return (
    <aside
      ref={overlayRef}
      aria-label={t('chat.workStatus.ariaLabel')}
      aria-hidden={!interactive}
      // The card stays mounted while hidden so it can animate its own collapse,
      // and the sections button sits outside the content gate. Without `inert`
      // Tab could land on an invisible control — and `aria-hidden` around a
      // focusable descendant is an accessibility fault in its own right.
      inert={!interactive}
      className={cn(
        // `self-start` keeps the card at content height instead of stretching
        // to the row; `max-h` then caps it so a long panel scrolls rather than
        // overflowing the chat.
        // A left margin as well as a right one: flush against the transcript
        // the card's own shadow had no room and was clipped down that edge.
        'relative my-4 flex min-w-0 shrink flex-col self-start overflow-hidden',
        'max-h-[calc(100%-2rem)]',
        interactive ? 'ml-2 mr-4' : 'ml-0 mr-0',
        // Out of the flow entirely, anchored to the chat column's top-right so
        // it reads as a dropdown from the header button. As a flex child it
        // took part in the layout and pushed the transcript, which is the one
        // thing an overlay must not do. Stronger shadow: it sits on content now.
        overlay && [
          'absolute right-3 top-3 z-30 mx-0 my-0',
          'max-h-[calc(100%-1.5rem)]',
          'shadow-[0_8px_28px_-8px_rgb(0_0_0_/_0.28)]',
          // Beside the transcript the translucent fill reads as depth; on top
          // of it, message bubbles showed straight through the rows. Frosting
          // separates the two without going fully opaque.
          'oc-glass-panel',
        ],
        // When every section is hidden the card keeps its border and background
        // so the settings button stays discoverable — going transparent made the
        // only recovery path unreachable.
        'motion-reduce:transition-none',
        'rounded-xl border border-[var(--interactive-border)]',
        !overlay && 'bg-[var(--surface-muted)]/40',
        // A lighter version of the composer's lift: the same shape, but this
        // card is taller, so the composer's spread reads as heavy here.
        'shadow-[0_2px_8px_-3px_rgb(0_0_0_/_0.08)]',
      )}
      style={{
        // The overlay keeps its width: it takes no space from the chat, so
        // collapsing it would animate a dimension nothing depends on. It fades
        // and lifts instead, like the dropdown it reads as.
        width: overlay || interactive ? WORK_STATUS_PANEL_WIDTH : 0,
        maxWidth: overlay ? undefined : `calc(100% - ${PARENT_CHAT_MIN_WIDTH}px)`,
        opacity: interactive ? 1 : 0,
        transform: visible
          ? 'translateY(0) scale(1)'
          : overlay
            ? 'translateY(-6px) scale(0.98)'
            // Inline: leaves to the right and arrives from it, so the card
            // reads as sliding out past the window edge.
            : `translateX(${WORK_STATUS_PANEL_WIDTH / 4}px)`,
        transformOrigin: 'top right',
        transitionProperty: 'width, opacity, transform, margin',
        transitionDuration: `${PANEL_TRANSITION_MS}ms`,
        transitionTimingFunction: PANEL_TRANSITION_EASING,
        pointerEvents: interactive ? undefined : 'none',
      }}
    >
      <WorkStatusContents
        sessionId={sessionId}
        directory={directory}
        repositoryEnabled={repositoryEnabled}
        contentMounted={contentMounted}
        visible={visible}
        restoreScroll={restore}
        onScroll={handleScroll}
        onPresenceChange={setRenderedSections}
      />
    </aside>
  );
};
