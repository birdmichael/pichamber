import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'bun:test';

import {
    USER_BUBBLE_FLEX_ITEM_CLASS,
    USER_BUBBLE_HOVER_ACTIONS_SHIFT_CLASS,
    USER_MESSAGE_CONTENT_OVERFLOW_CLASS,
    USER_TEXT_COLLAPSED_CLASS,
    USER_TEXT_COMPACT_CLAMP_CLASS,
    USER_TEXT_EXPANDED_CLASS,
    USER_TEXT_PARENT_WRAP_CLASS,
    getUserBubbleHoverActionsFrameClass,
    getUserMessageContentOverflowClass,
    getUserTextClampClass,
    isUserTextOverflowing,
} from './userBubbleLayout';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

    test('parent user bubble does not use line-clamp-1 for normal text', () => {
        expect(USER_TEXT_PARENT_WRAP_CLASS).toContain('whitespace-normal');
        expect(USER_TEXT_PARENT_WRAP_CLASS).toContain('break-words');
        expect(USER_TEXT_PARENT_WRAP_CLASS).not.toContain('line-clamp-1');
        expect(USER_TEXT_PARENT_WRAP_CLASS).not.toContain('line-clamp-2');
        expect(USER_TEXT_PARENT_WRAP_CLASS).not.toContain('truncate');
        expect(USER_TEXT_PARENT_WRAP_CLASS).not.toContain('nowrap');

        expect(getUserTextClampClass({ collapsed: false })).toBeUndefined();
        expect(getUserTextClampClass({ collapsed: true })).toBeUndefined();
        expect(getUserTextClampClass({ collapsed: true, compact: false })).toBeUndefined();
        expect(getUserTextClampClass({ collapsed: true, compact: true })).toBe(USER_TEXT_COMPACT_CLAMP_CLASS);
        expect(USER_TEXT_COMPACT_CLAMP_CLASS).toBe('line-clamp-2');
        expect(USER_TEXT_COMPACT_CLAMP_CLASS).not.toContain('line-clamp-1');
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

const userTextPartSource = readFileSync(join(__dirname, 'parts/UserTextPart.tsx'), 'utf-8');

describe('UserTextPart parent clamp wiring', () => {
    test('does not apply line-clamp-1 or a compact clamp in the main parent column', () => {
        expect(userTextPartSource).toContain('getUserTextClampClass');
        expect(userTextPartSource).toContain('USER_TEXT_PARENT_WRAP_CLASS');
        expect(userTextPartSource).toContain('compact: false');
        expect(userTextPartSource).not.toMatch(/line-clamp-1/);
        expect(userTextPartSource).not.toMatch(/isCollapsed && \[\s*"line-clamp-2"/);
    });
});
