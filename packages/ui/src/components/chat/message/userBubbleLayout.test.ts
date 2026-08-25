import { describe, expect, test } from 'bun:test';

import {
    USER_BUBBLE_FLEX_ITEM_CLASS,
    USER_BUBBLE_HOVER_ACTIONS_SHIFT_CLASS,
    USER_MESSAGE_CONTENT_OVERFLOW_CLASS,
    USER_TEXT_COLLAPSED_CLASS,
    USER_TEXT_EXPANDED_CLASS,
    getUserBubbleHoverActionsFrameClass,
    getUserMessageContentOverflowClass,
    isUserTextOverflowing,
} from './userBubbleLayout';

describe('userBubbleLayout', () => {
    test('user bubble flex item can shrink and wrap inside the 85% cap', () => {
        expect(USER_BUBBLE_FLEX_ITEM_CLASS).toContain('min-w-0');
        expect(USER_BUBBLE_FLEX_ITEM_CLASS).toContain('w-fit');
        expect(USER_BUBBLE_FLEX_ITEM_CLASS).toContain('max-w-[85%]');
    });

    test('hover actions stay inside the right-aligned bubble instead of shifting past the column', () => {
        expect(USER_BUBBLE_HOVER_ACTIONS_SHIFT_CLASS).toBe('translate-x-0');
        expect(USER_BUBBLE_HOVER_ACTIONS_SHIFT_CLASS).not.toMatch(/translate-x-(?:[1-9]\d*|px)/);

        const desktopInline = getUserBubbleHoverActionsFrameClass({
            isMobile: false,
            inline: true,
            stickyUserHeaderEnabled: true,
        });
        expect(desktopInline).toContain('absolute');
        expect(desktopInline).toContain('left-0');
        expect(desktopInline).toContain('right-0');
        expect(desktopInline).toContain('max-w-full');
        expect(desktopInline).not.toMatch(/translate-x-(?:[1-9]\d*|px)/);

        const desktopExternal = getUserBubbleHoverActionsFrameClass({
            isMobile: false,
            inline: false,
            stickyUserHeaderEnabled: false,
        });
        expect(desktopExternal).toContain('justify-end');
        expect(desktopExternal).toContain('max-w-full');
        expect(desktopExternal).not.toMatch(/translate-x-(?:[1-9]\d*|px)/);
    });

    test('collapsed user text uses a class that inlines markdown blocks for line-clamp', () => {
        expect(USER_TEXT_COLLAPSED_CLASS).toBe('user-text-collapsed');
    });

    test('expanded user text uses a class that wraps CJK instead of clipping glyphs', () => {
        expect(USER_TEXT_EXPANDED_CLASS).toBe('user-text-expanded');
        expect(USER_MESSAGE_CONTENT_OVERFLOW_CLASS.default).toContain('overflow-x-clip');
        expect(USER_MESSAGE_CONTENT_OVERFLOW_CLASS.default).not.toContain('overflow-x-hidden');
    });

    test('non-sticky user content does not hide overflow-y as a line-clamp substitute', () => {
        expect(USER_MESSAGE_CONTENT_OVERFLOW_CLASS.default).not.toContain('overflow-y-hidden');
        expect(USER_MESSAGE_CONTENT_OVERFLOW_CLASS.default).toContain('overflow-x-clip');
        expect(getUserMessageContentOverflowClass(false)).toBe(USER_MESSAGE_CONTENT_OVERFLOW_CLASS.default);
        expect(getUserMessageContentOverflowClass(true)).toContain('overflow-y-auto');
    });

    test('treats vertical or horizontal overflow as truncated', () => {
        expect(isUserTextOverflowing({
            scrollHeight: 48,
            clientHeight: 40,
            scrollWidth: 200,
            clientWidth: 200,
        })).toBe(true);

        expect(isUserTextOverflowing({
            scrollHeight: 20,
            clientHeight: 20,
            scrollWidth: 400,
            clientWidth: 200,
        })).toBe(true);

        expect(isUserTextOverflowing({
            scrollHeight: 20,
            clientHeight: 20,
            scrollWidth: 200,
            clientWidth: 200,
        })).toBe(false);
    });
});
