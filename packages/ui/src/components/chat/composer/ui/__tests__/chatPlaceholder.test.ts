import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import {
  COMPACT_CHAT_PLACEHOLDER_MAX_WIDTH,
  DESKTOP_RIGHT_RAIL_CHAT_COLUMN_PX,
  shouldUseCompactChatPlaceholder,
} from '../chatPlaceholder';

const __dirname = dirname(fileURLToPath(import.meta.url));
const chatInputSource = readFileSync(join(__dirname, '../../../ChatInput.tsx'), 'utf-8');

describe('shouldUseCompactChatPlaceholder', () => {
  test('keeps the full helper line on a typical Desktop chat column with a right rail', () => {
    expect(DESKTOP_RIGHT_RAIL_CHAT_COLUMN_PX).toBeGreaterThan(COMPACT_CHAT_PLACEHOLDER_MAX_WIDTH);
    expect(shouldUseCompactChatPlaceholder({
      isMobile: false,
      composerWidth: DESKTOP_RIGHT_RAIL_CHAT_COLUMN_PX,
    })).toBe(false);
  });

  test('keeps the full helper line after chat-input-column padding on that rail layout', () => {
    const paddedComposerWidth = DESKTOP_RIGHT_RAIL_CHAT_COLUMN_PX - 48;
    expect(paddedComposerWidth).toBeGreaterThanOrEqual(COMPACT_CHAT_PLACEHOLDER_MAX_WIDTH);
    expect(shouldUseCompactChatPlaceholder({
      isMobile: false,
      composerWidth: paddedComposerWidth,
    })).toBe(false);
  });

  test('uses the short stub only when the desktop composer is actually tiny', () => {
    expect(shouldUseCompactChatPlaceholder({
      isMobile: false,
      composerWidth: COMPACT_CHAT_PLACEHOLDER_MAX_WIDTH - 1,
    })).toBe(true);
    expect(shouldUseCompactChatPlaceholder({
      isMobile: false,
      composerWidth: COMPACT_CHAT_PLACEHOLDER_MAX_WIDTH,
    })).toBe(false);
  });

  test('uses the short stub on mobile regardless of composer width', () => {
    expect(shouldUseCompactChatPlaceholder({
      isMobile: true,
      composerWidth: 800,
    })).toBe(true);
  });

  test('does not treat an unmeasured width as compact on desktop', () => {
    expect(shouldUseCompactChatPlaceholder({
      isMobile: false,
      composerWidth: 0,
    })).toBe(false);
  });

  test('ChatInput uses the helper instead of a local width cutoff', () => {
    expect(chatInputSource).toContain('shouldUseCompactChatPlaceholder');
    expect(chatInputSource).not.toMatch(/COMPACT_CHAT_PLACEHOLDER_MAX_WIDTH\s*=\s*560/);
  });
});
