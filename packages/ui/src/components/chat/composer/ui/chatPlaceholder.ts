/**
 * When to show the short composer helper stub instead of the full
 * `@ / ! #` placeholder.
 *
 * A typical Desktop ~1280 window with Session, Walkthrough, or notes open
 * leaves about a 355px chat column. That is still a desktop composer: keep
 * the full helper line. The stub is for true mobile or an actually tiny
 * editor, not a normal right rail.
 */
export const DESKTOP_RIGHT_RAIL_CHAT_COLUMN_PX = 355;

/**
 * Composer (drop-zone) width below which the short stub is used.
 * Must stay under the padded desktop+right-rail composer so opening a
 * right panel does not collapse the helper copy.
 */
export const COMPACT_CHAT_PLACEHOLDER_MAX_WIDTH = 280;

export function shouldUseCompactChatPlaceholder(options: {
  isMobile: boolean;
  composerWidth: number;
}): boolean {
  if (options.isMobile) return true;
  return options.composerWidth > 0 && options.composerWidth < COMPACT_CHAT_PLACEHOLDER_MAX_WIDTH;
}
