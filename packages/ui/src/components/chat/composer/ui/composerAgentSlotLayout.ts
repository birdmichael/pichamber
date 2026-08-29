/**
 * Hide the composer Agent chip from the real parent-column / footer /
 * chip-row width, not a @container ancestor that may still be the window.
 *
 * Parent main-window ChatInput lives under `[data-parent-chat-column]`. At
 * the original 1280 squeeze (parent + Work Status + child tabs) that column
 * is ~328px, but the chip row and even the footer can still report a wide
 * overflowing box — CSS hide then paints a 2-letter `Ag`. ChatInput measures
 * that column (ResizeObserver) and ModelControls omits the Agent slot from
 * the DOM below 576px. When Work Status / child close and the column is
 * wide again, Agent remounts. CSS hide stays as backup.
 *
 * Child/embedded chat is the same ComposerFooter inside an iframe
 * (`?ocPanel=session-chat`). Nesting `@container model-controls` under
 * `html` can still resolve against that document's root, so a 315–500px
 * child footer keeps painting `A` / `Agen(`. Measure the chip row and
 * footer in this document for the CSS backup.
 */

import React from 'react';

/** 36rem at the 16px root — hide / omit Agent below this column / footer width. */
export const COMPOSER_AGENT_SLOT_HIDE_BELOW_PX = 576;

export const COMPOSER_AGENT_SLOT_HIDE_CLASS = 'model-controls--hide-agent';

export const COMPOSER_FOOTER_ATTR = 'data-chat-input-footer';

export const COMPOSER_FOOTER_SELECTOR = `[${COMPOSER_FOOTER_ATTR}="true"]`;

export const PARENT_CHAT_COLUMN_ATTR = 'data-parent-chat-column';

export const PARENT_CHAT_COLUMN_SELECTOR = `[${PARENT_CHAT_COLUMN_ATTR}="true"]`;

export type ComposerAgentSlotMetrics = {
  rowWidth: number;
  footerWidth?: number;
  parentColumnWidth?: number;
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
 * Omit the Agent slot from the DOM when the parent chat column is below
 * 576px. A ~328px squeeze must not mount a clipped `Ag` pill. If the
 * column lookup missed, a squeezed footer is enough — the chip row can
 * still report a wide overflowing box.
 */
export function shouldOmitComposerAgentSlot(
  parentColumnWidth: number | undefined,
  footerWidth?: number,
): boolean {
  if (isBelowHideBand(parentColumnWidth)) {
    return true;
  }
  const columnMeasured = typeof parentColumnWidth === 'number' && parentColumnWidth > 0;
  if (columnMeasured) {
    return false;
  }
  return isBelowHideBand(footerWidth);
}

/**
 * CSS-hide backup: Agent when the parent column / footer / chip row is
 * below 576px, or when the slot / label overflow-clips (`Ag` / `A` sliver
 * / `Agen(`). A 2-letter `Ag` truncation is a fail — hide the whole slot,
 * not a compact label. A wide parent column (~1000px) with no overflow
 * stays visible.
 */
export function shouldHideComposerAgentSlot(metrics: ComposerAgentSlotMetrics): boolean {
  if (
    isBelowHideBand(metrics.parentColumnWidth)
    || isBelowHideBand(metrics.footerWidth)
    || isBelowHideBand(metrics.rowWidth)
  ) {
    return true;
  }
  return isOverflowingBox(metrics.agentScrollWidth, metrics.agentClientWidth)
    || isOverflowingBox(metrics.agentLabelScrollWidth, metrics.agentLabelClientWidth);
}

export function measureComposerAgentSlot(
  row: HTMLElement,
  footer?: HTMLElement | null,
  parentColumn?: HTMLElement | null,
): ComposerAgentSlotMetrics {
  const slot = row.querySelector<HTMLElement>('.model-controls__agent-slot');
  const label = row.querySelector<HTMLElement>('.model-controls__agent-label');
  const footerEl = footer ?? row.closest?.<HTMLElement>(COMPOSER_FOOTER_SELECTOR) ?? null;
  const columnEl = parentColumn
    ?? row.closest?.<HTMLElement>(PARENT_CHAT_COLUMN_SELECTOR)
    ?? null;
  return {
    rowWidth: row.clientWidth,
    footerWidth: footerEl?.clientWidth,
    parentColumnWidth: columnEl?.clientWidth,
    agentScrollWidth: slot?.scrollWidth,
    agentClientWidth: slot?.clientWidth,
    agentLabelScrollWidth: label?.scrollWidth,
    agentLabelClientWidth: label?.clientWidth,
  };
}

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

/**
 * Observe the parent chat column (and squeezed footer as backup) until the
 * composer host exists. `composerFormRef` is often still null on the first
 * layout effect — the ref object identity never changes, so returning early
 * would leave omit stuck false and paint a clipped `Ag`.
 */
export function observeParentChatColumnAgentOmit(
  hostRef: React.RefObject<HTMLElement | null>,
  setOmit: (next: boolean) => void,
): () => void {
  let cancelled = false;
  let rafId = 0;
  let observer: ResizeObserver | undefined;
  let onResize: (() => void) | undefined;

  const stopListening = () => {
    observer?.disconnect();
    observer = undefined;
    if (onResize) {
      window.removeEventListener('resize', onResize);
      onResize = undefined;
    }
  };

  const attach = () => {
    if (cancelled) {
      return;
    }

    const host = hostRef.current;
    if (!host) {
      rafId = requestAnimationFrame(attach);
      return;
    }

    const column = host.closest<HTMLElement>(PARENT_CHAT_COLUMN_SELECTOR)
      ?? document.querySelector<HTMLElement>(PARENT_CHAT_COLUMN_SELECTOR);
    const footer = host.closest<HTMLElement>(COMPOSER_FOOTER_SELECTOR)
      ?? document.querySelector<HTMLElement>(COMPOSER_FOOTER_SELECTOR);

    const update = () => {
      setOmit(shouldOmitComposerAgentSlot(column?.clientWidth, footer?.clientWidth));
    };

    update();

    if (!column && !footer) {
      return;
    }

    if (typeof ResizeObserver === 'undefined') {
      onResize = update;
      window.addEventListener('resize', update);
      return;
    }

    observer = new ResizeObserver(update);
    if (column) {
      observer.observe(column);
    }
    if (footer) {
      observer.observe(footer);
    }
  };

  attach();

  return () => {
    cancelled = true;
    cancelAnimationFrame(rafId);
    stopListening();
  };
}

/**
 * ChatInput under `[data-parent-chat-column]` observes that column.
 * Returns whether ModelControls must omit the Agent slot (`null`), not
 * `display:none` a clipped pill. When the column is wide again, the
 * caller remounts Agent. CSS hide remains backup.
 */
export function useParentChatColumnAgentOmit(
  hostRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
): boolean {
  const [omit, setOmit] = React.useState(false);

  useIsomorphicLayoutEffect(() => {
    if (!enabled) {
      setOmit(false);
      return;
    }

    return observeParentChatColumnAgentOmit(hostRef, (next) => {
      setOmit((prev) => (prev === next ? prev : next));
    });
  }, [enabled, hostRef]);

  return enabled && omit;
}

/**
 * Observe the composer footer and chip row (parent main window and
 * child/iframe). Returns whether `.model-controls__agent-slot` should be
 * `display: none`. CSS backup if DOM omit misses — a squeezed ~328px
 * column can clip `Ag` while the overflowing chip row stays wide.
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
      ?? row.closest<HTMLElement>(COMPOSER_FOOTER_SELECTOR);
    const parentColumn = row.closest<HTMLElement>(PARENT_CHAT_COLUMN_SELECTOR);

    const update = () => {
      const next = shouldHideComposerAgentSlot(
        measureComposerAgentSlot(row, footer, parentColumn),
      );
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
    if (parentColumn) {
      observer.observe(parentColumn);
    }
    return () => observer.disconnect();
  }, [enabled, rowRef, footerRef]);

  return enabled && hide;
}
