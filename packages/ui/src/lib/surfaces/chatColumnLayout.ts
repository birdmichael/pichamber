/**
 * Horizontal budget for the chat area: parent transcript, optional Work
 * Status card, and the context panel (child tabs, git, …).
 *
 * The previous 280px reservation lived only in ContextPanel.clampWidth and
 * treated `<main>` as "the parent". Work Status sits *inside* `<main>` as a
 * shrink-0 sibling of the transcript (`min-w-0 flex-1`), so that 280px was
 * eaten by the 300px card and the first message collapsed to ~150px.
 */

/** Usable floor for the parent transcript + composer. Honored in CSS, not only as a clamp hint. */
export const PARENT_CHAT_MIN_WIDTH = 320;

/** Fixed Work Status card width. The panel is not user-resizable. */
export const WORK_STATUS_PANEL_WIDTH = 300;

/** The card's own horizontal margins (`ml-2` + `mr-4`). */
export const WORK_STATUS_PANEL_GUTTER = 8 + 16;

export const WORK_STATUS_OCCUPIED_WIDTH = WORK_STATUS_PANEL_WIDTH + WORK_STATUS_PANEL_GUTTER;

/**
 * Transcript leftover the Work Status *visibility* test wants when the
 * context panel is closed. Wider than {@link PARENT_CHAT_MIN_WIDTH} so a
 * lone Work Status card does not appear on a still-narrow chat.
 */
export const WORK_STATUS_MIN_CHAT_WIDTH = 560;

/** Chat-area width below which Work Status yields its column. */
export const WORK_STATUS_REQUIRED_ROW_WIDTH =
  WORK_STATUS_OCCUPIED_WIDTH + WORK_STATUS_MIN_CHAT_WIDTH;

export const workStatusOccupiedWidth = (inline: boolean): number => (
  inline ? WORK_STATUS_OCCUPIED_WIDTH : 0
);

/** Space `<main>` must keep: parent floor + inline Work Status, if any. */
export const reservedMainWidthForContextPanel = (workStatusInline: boolean): number => (
  PARENT_CHAT_MIN_WIDTH + workStatusOccupiedWidth(workStatusInline)
);

export const maxContextPanelWidth = (
  availableWidth: number,
  workStatusInline: boolean,
): number => {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, Math.round(availableWidth) - reservedMainWidthForContextPanel(workStatusInline));
};

export const clampContextPanelLayoutWidth = (
  width: number,
  availableWidth: number | null | undefined,
  options: {
    workStatusInline?: boolean;
    minWidth?: number;
    maxWidth?: number;
  } = {},
): number => {
  const minWidth = options.minWidth ?? 380;
  const maxWidth = options.maxWidth ?? 1400;
  if (!Number.isFinite(width)) {
    return Math.min(maxWidth, minWidth);
  }

  const maxForChat = availableWidth && availableWidth > 0
    ? maxContextPanelWidth(availableWidth, Boolean(options.workStatusInline))
    : maxWidth;
  const floor = Math.min(minWidth, maxForChat);
  return Math.min(maxWidth, maxForChat, Math.max(floor, Math.round(width)));
};

/** Parent leftover after the context panel and an optional Work Status card. */
export const parentChatWidthAfterLayout = (
  availableWidth: number,
  contextPanelWidth: number,
  workStatusInline: boolean,
): number => (
  Math.round(availableWidth) - Math.round(contextPanelWidth) - workStatusOccupiedWidth(workStatusInline)
);
