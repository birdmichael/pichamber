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
 */

/** Flex item wrapping the user bubble: shrink-to-fit, cap at 85%, allow wrap. */
export const USER_BUBBLE_FLEX_ITEM_CLASS = 'min-w-0 w-fit max-w-[85%]';

/**
 * Applied to the collapsed user-text wrapper so line-clamp sees inline boxes.
 * CSS in `index.css` inlines `[data-md-block]` descendants.
 */
export const USER_TEXT_COLLAPSED_CLASS = 'user-text-collapsed';

export const USER_MESSAGE_CONTENT_OVERFLOW_CLASS = {
    sticky: 'min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain scrollbar-none',
    default: 'min-w-0 overflow-x-hidden',
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
