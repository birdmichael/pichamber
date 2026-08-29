/**
 * Hide the composer Agent chip from the real chip-row width, not a
 * @container ancestor that may still be the window / parent pane.
 *
 * Child/embedded chat is the same ComposerFooter inside an iframe
 * (`?ocPanel=session-chat`). Nesting `@container model-controls` under
 * `html` can still resolve against that document's root (or a leftover
 * named container on html), so a 315–500px child footer keeps painting
 * `A` / `Agen(`. Measure the chip row (or footer) in this document.
 */

import React from 'react';

/** 36rem at the 16px root — hide Agent below this chip-row / footer width. */
export const COMPOSER_AGENT_SLOT_HIDE_BELOW_PX = 576;

export const COMPOSER_AGENT_SLOT_HIDE_CLASS = 'model-controls--hide-agent';

export type ComposerAgentSlotMetrics = {
  rowWidth: number;
  agentScrollWidth?: number;
  agentClientWidth?: number;
};

/**
 * Hide Agent when the chip row is below 576px, or when the slot itself
 * is overflow-clipping (`A` sliver / `Agen(`). A wide parent row
 * (~1000px) stays visible. `clientWidth === 0` means the slot is not
 * laid out (already `display: none` or unmounted) — do not treat that
 * as overflow, or hide↔show will flicker.
 */
export function shouldHideComposerAgentSlot(metrics: ComposerAgentSlotMetrics): boolean {
  if (metrics.rowWidth > 0 && metrics.rowWidth < COMPOSER_AGENT_SLOT_HIDE_BELOW_PX) {
    return true;
  }
  const scroll = metrics.agentScrollWidth ?? 0;
  const client = metrics.agentClientWidth ?? 0;
  return client > 0 && scroll > client;
}

export function measureComposerAgentSlot(row: HTMLElement): ComposerAgentSlotMetrics {
  const slot = row.querySelector<HTMLElement>('.model-controls__agent-slot');
  return {
    rowWidth: row.clientWidth,
    agentScrollWidth: slot?.scrollWidth,
    agentClientWidth: slot?.clientWidth,
  };
}

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

/**
 * Observe the composer chip row (parent and child/iframe). Returns
 * whether `.model-controls__agent-slot` should be `display: none`.
 */
export function useComposerAgentSlotHide(
  rowRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
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

    const update = () => {
      const next = shouldHideComposerAgentSlot(measureComposerAgentSlot(row));
      setHide((prev) => (prev === next ? prev : next));
    };

    update();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }

    const observer = new ResizeObserver(update);
    observer.observe(row);
    return () => observer.disconnect();
  }, [enabled, rowRef]);

  return enabled && hide;
}
