import React from 'react';
import { useUIStore } from '@/stores/useUIStore';
import {
  WORK_STATUS_PANEL_WIDTH,
  WORK_STATUS_REQUIRED_ROW_WIDTH,
} from '@/lib/surfaces/chatColumnLayout';

export { WORK_STATUS_PANEL_WIDTH, WORK_STATUS_REQUIRED_ROW_WIDTH };

type Options = {
  isMobile: boolean;
  isVSCode: boolean;
};

type Result = {
  /** Layout can host the panel inline, regardless of the user's switch. */
  fits: boolean;
  /**
   * Attach to the flex row that contains the chat column and the panel.
   *
   * A callback ref, not an object ref: an object ref gives no signal when the
   * node attaches, so a measuring effect that reads `.current` would silently
   * observe nothing whenever the row mounts after the effect first ran, and
   * would only recover on the next unrelated dependency change.
   */
  rowRef: (node: HTMLDivElement | null) => void;
  visible: boolean;
};

/**
 * Decides whether the work-status panel may occupy space inside the chat.
 *
 * The width test measures the chat AREA (chat + context panel), never the
 * chat column alone. The chat column's width is an output of this decision:
 * hiding the panel widens it, which would re-satisfy a chat-width test and
 * re-show the panel, oscillating forever. The chat-area width does not move
 * when this panel or the context panel opens, so it is the only stable input.
 *
 * A child tab (context panel) must not hide this card. Child chats are stored
 * under `session:<parent>` and merged in; looking only at the project
 * directory already missed them, and hiding the card on an open context panel
 * would close the only place to switch children. Width is enforced by
 * reserving the parent transcript in `chatColumnLayout` instead.
 */
export const useWorkStatusVisibility = ({ isMobile, isVSCode }: Options): Result => {
  const [rowNode, setRowNode] = React.useState<HTMLDivElement | null>(null);
  const [rowWidth, setRowWidth] = React.useState<number | null>(null);
  const rowRef = React.useCallback((node: HTMLDivElement | null) => { setRowNode(node); }, []);

  // The user's own switch, persisted to server settings, gates everything
  // before layout is even measured.
  const panelEnabled = useUIStore((state) => state.workStatusPanelEnabled);

  const layoutAllows = !isMobile && !isVSCode;

  React.useEffect(() => {
    if (!rowNode || typeof ResizeObserver === 'undefined') return undefined;

    const measured = rowNode.closest<HTMLElement>('[data-chat-area]') ?? rowNode;
    setRowWidth(measured.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setRowWidth(entry.contentRect.width);
    });
    observer.observe(measured);
    return () => observer.disconnect();
  }, [rowNode]);

  const fits = layoutAllows && rowWidth !== null && rowWidth >= WORK_STATUS_REQUIRED_ROW_WIDTH;
  const visible = panelEnabled && fits;

  return { rowRef, visible, fits };
};
