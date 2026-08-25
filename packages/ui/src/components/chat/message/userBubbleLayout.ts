/**
 * User-bubble wrap and collapse layout.
 *
 * Collapsed user prompts may use line-clamp. The markdown renderer wraps each
 * block in `display:contents` `[data-md-block]`, so the real boxes are inner
 * paragraphs. `-webkit-line-clamp` cannot clamp those block descendants —
 * paragraphs must be inlined (same as collapsed code) or clamp a plain-text
 * preview instead.
 *
 * The bubble is a shrink-to-fit flex item. Without `min-w-0` it will not
 * shrink below the unwrapped content width, so a long paragraph stays one
 * line and gets clipped.
 *
 * Hover actions sit inside that same right-aligned box. Do not shift them
 * past the bubble edge — the chat scroller clips overflow-x.
 */

/** Flex item wrapping the user bubble: shrink-to-fit, cap at 85%, allow wrap. */
export const USER_BUBBLE_FLEX_ITEM_CLASS = 'min-w-0 w-fit max-w-[85%]';

/**
 * User bubbles are right-aligned against the message column. A positive
 * translate-x paints the hover strip past that edge, where overflow-x on the
 * chat scroller clips it. Keep the strip inside the bubble/column.
 */
export const USER_BUBBLE_HOVER_ACTIONS_SHIFT_CLASS = 'translate-x-0';

export function getUserBubbleHoverActionsFrameClass(options: {
    isMobile: boolean;
    inline: boolean;
    stickyUserHeaderEnabled: boolean;
}): string {
    if (options.isMobile) {
        if (options.inline) {
            return 'flex items-center justify-end pt-2 pb-3';
        }
        return options.stickyUserHeaderEnabled
            ? 'flex h-9 items-start justify-end pt-0'
            : 'flex h-11 items-start justify-end pt-0';
    }
    if (options.inline) {
        return 'absolute top-full left-0 right-0 z-10 max-w-full pt-5';
    }
    return 'flex h-8 max-w-full items-start justify-end pt-2';
}

/**
 * Applied to the collapsed user-text wrapper so line-clamp sees inline boxes.
 * CSS in `index.css` inlines `[data-md-block]` descendants.
 */
export const USER_TEXT_COLLAPSED_CLASS = 'user-text-collapsed';

/** Expanded long CJK must wrap whole glyphs instead of clipping at the edge. */
export const USER_TEXT_EXPANDED_CLASS = 'user-text-expanded';

export const USER_MESSAGE_CONTENT_OVERFLOW_CLASS = {
    sticky: 'min-w-0 overflow-x-clip overflow-y-auto overscroll-contain scrollbar-none',
    default: 'min-w-0 overflow-x-clip',
} as const;

export function getUserMessageContentOverflowClass(useStickyScrollableUserContent: boolean): string {
    return useStickyScrollableUserContent
        ? USER_MESSAGE_CONTENT_OVERFLOW_CLASS.sticky
        : USER_MESSAGE_CONTENT_OVERFLOW_CLASS.default;
}

export function isUserTextOverflowing(el: {
    scrollHeight: number;
    clientHeight: number;
    scrollWidth: number;
    clientWidth: number;
}): boolean {
    return el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth;
}
