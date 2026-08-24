import { describe, expect, test } from 'bun:test';

import {
    USER_BUBBLE_FLEX_ITEM_CLASS,
    USER_MESSAGE_CONTENT_OVERFLOW_CLASS,
    USER_TEXT_COLLAPSED_CLASS,
    getUserMessageContentOverflowClass,
    isUserTextOverflowing,
} from './userBubbleLayout';

describe('userBubbleLayout', () => {
    test('user bubble flex item can shrink and wrap inside the 85% cap', () => {
        expect(USER_BUBBLE_FLEX_ITEM_CLASS).toContain('min-w-0');
        expect(USER_BUBBLE_FLEX_ITEM_CLASS).toContain('w-fit');
        expect(USER_BUBBLE_FLEX_ITEM_CLASS).toContain('max-w-[85%]');
    });

    test('collapsed user text uses a class that inlines markdown blocks for line-clamp', () => {
        expect(USER_TEXT_COLLAPSED_CLASS).toBe('user-text-collapsed');
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
