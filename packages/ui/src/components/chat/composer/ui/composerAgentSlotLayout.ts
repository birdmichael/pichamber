/**
 * Hide the composer Agent chip from the real footer / chip-row width, not a
 * @container ancestor that may still be the window / parent pane.
 *
 * Parent main-window chat uses this same ComposerFooter (ChatInput). At the
 * original 1280 squeeze (parent + Work Status + child tabs) that footer is
 * ~328px, but the chip row can still report a wide overflowing box — so a
 * row-only measure keeps painting a 2-letter `Ag`. Measure the footer too.
 *
 * Child/embedded chat is the same ComposerFooter inside an iframe
 * (`?ocPanel=session-chat`). Nesting `@container model-controls` under
 * `html` can still resolve against that document's root (or a leftover
 * named container on html), so a 315–500px child footer keeps painting
 * `A` / `Agen(`. Measure the chip row and footer in this document.
 */

import React from 'react';

/** 36rem at the 16px root — hide Agent below this chip-row / footer width. */
export const COMPOSER_AGENT_SLOT_HIDE_BELOW_PX = 576;

export const COMPOSER_AGENT_SLOT_HIDE_CLASS = 'model-controls--hide-agent';

export const COMPOSER_FOOTER_ATTR = 'data-chat-input-footer';

export type ComposerAgentSlotMetrics = {
  rowWidth: number;
  footerWidth?: number;
  agentScrollWidth?: number;
  agentClientWidth?: number;
  agentLabelScrollWidth?: number;
  agentLabelClientWidth?: number;
};

const isBelowHideBand = (width: number | undefined): boolean => (
  typeof width === 'number' && width > 0 && width < COMPOSER_AGENT_SLOT_HIDE_BELOW_PX
);

const isOverflowingBox = (scrollWidth?: number, clientWidth?: number): boolean => {
  const scroll = scrollWidth ?? 0;
  const client = clientWidth ?? 0;
  // clientWidth === 0 means the box is not laid out (already display:none
  // or unmounted) — do not treat that as overflow, or hide↔show will flicker.
  return client > 0 && scroll > client;
};

/**
 * Hide Agent when the parent/child footer or chip row is below 576px, or
 * when the slot / label overflow-clips (`Ag` / `A` sliver / `Agen(`). A
 * 2-letter `Ag` truncation is a fail — hide the whole slot, not a compact
 * label. A wide parent footer (~1000px) with no overflow stays visible.
 */
export function shouldHideComposerAgentSlot(metrics: ComposerAgentSlotMetrics): boolean {
  if (isBelowHideBand(metrics.footerWidth) || isBelowHideBand(metrics.rowWidth)) {
    return true;
  }
  return isOverflowingBox(metrics.agentScrollWidth, metrics.agentClientWidth)
    || isOverflowingBox(metrics.agentLabelScrollWidth, metrics.agentLabelClientWidth);
}

export function measureComposerAgentSlot(
  row: HTMLElement,
  footer?: HTMLElement | null,
): ComposerAgentSlotMetrics {
  const slot = row.querySelector<HTMLElement>('.model-controls__agent-slot');
  const label = row.querySelector<HTMLElement>('.model-controls__agent-label');
  const footerEl = footer ?? row.closest?.<HTMLElement>(`[${COMPOSER_FOOTER_ATTR}="true"]`) ?? null;
  return {
    rowWidth: row.clientWidth,
    footerWidth: footerEl?.clientWidth,
    agentScrollWidth: slot?.scrollWidth,
    agentClientWidth: slot?.clientWidth,
    agentLabelScrollWidth: label?.scrollWidth,
    agentLabelClientWidth: label?.clientWidth,
  };
}

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

/**
 * Observe the composer footer and chip row (parent main window and
 * child/iframe). Returns whether `.model-controls__agent-slot` should be
 * `display: none`. The parent path must observe the footer — a squeezed
 * ~328px column can clip `Ag` while the overflowing chip row stays wide.
 */
export function useComposerAgentSlotHide(
  rowRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  footerRef?: React.RefObject<HTMLElement | null>,
): boolean {
  const [hide, setHide] = React.useState(false);

  useIsomorphicLayoutEffect(() => {
    if (!enabled) {
      setHide(false);
      return;
    }

    const row = rowRef.current;
    if (!row) {
      return;
    }

    const footer = footerRef?.current
      ?? row.closest<HTMLElement>(`[${COMPOSER_FOOTER_ATTR}="true"]`);

    const update = () => {
      const next = shouldHideComposerAgentSlot(measureComposerAgentSlot(row, footer));
      setHide((prev) => (prev === next ? prev : next));
    };

    update();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }

    const observer = new ResizeObserver(update);
    observer.observe(row);
    if (footer) {
      observer.observe(footer);
    }
    return () => observer.disconnect();
  }, [enabled, rowRef, footerRef]);

  return enabled && hide;
}
