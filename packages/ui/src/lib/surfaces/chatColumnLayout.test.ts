import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'bun:test';

import {
  PARENT_CHAT_MIN_WIDTH,
  WORK_STATUS_OCCUPIED_WIDTH,
  WORK_STATUS_REQUIRED_ROW_WIDTH,
  clampContextPanelLayoutWidth,
  maxContextPanelWidth,
  parentChatWidthAfterLayout,
  reservedMainWidthForContextPanel,
} from './chatColumnLayout';

describe('chat column layout', () => {
  test('reserves the parent floor plus Work Status when both sit beside a child tab', () => {
    expect(reservedMainWidthForContextPanel(false)).toBe(PARENT_CHAT_MIN_WIDTH);
    expect(reservedMainWidthForContextPanel(true)).toBe(
      PARENT_CHAT_MIN_WIDTH + WORK_STATUS_OCCUPIED_WIDTH,
    );
    expect(reservedMainWidthForContextPanel(true)).toBe(644);
  });

  test('caps the child pane so the parent cannot collapse below ~320px at a 1280 window', () => {
    // Live leftover: window ~1288, sidebar x≈305, child ~430, Work Status ~300,
    // parent ~150. Chat-area is the flex parent of <main> + ContextPanel.
    const chatArea = 1280 - 305;
    const desiredChild = 430;
    const clamped = clampContextPanelLayoutWidth(desiredChild, chatArea, { workStatusInline: true });
    const parent = parentChatWidthAfterLayout(chatArea, clamped, true);

    expect(clamped).toBeLessThan(desiredChild);
    expect(clamped).toBe(maxContextPanelWidth(chatArea, true));
    expect(parent).toBeGreaterThanOrEqual(PARENT_CHAT_MIN_WIDTH);
    expect(parent + WORK_STATUS_OCCUPIED_WIDTH + clamped).toBe(chatArea);
  });

  test('does not let a 45% default child width eat the parent when Work Status is inline', () => {
    const chatArea = 983;
    const fractionChild = Math.round(0.45 * chatArea);
    const clamped = clampContextPanelLayoutWidth(fractionChild, chatArea, { workStatusInline: true });
    expect(parentChatWidthAfterLayout(chatArea, clamped, true)).toBeGreaterThanOrEqual(PARENT_CHAT_MIN_WIDTH);
    expect(clamped).toBeLessThanOrEqual(chatArea - reservedMainWidthForContextPanel(true));
  });

  test('keeps a narrower child when Work Status is closed', () => {
    const chatArea = 800;
    const clamped = clampContextPanelLayoutWidth(430, chatArea, { workStatusInline: false });
    expect(clamped).toBe(430);
    expect(parentChatWidthAfterLayout(chatArea, clamped, false)).toBeGreaterThanOrEqual(PARENT_CHAT_MIN_WIDTH);
  });

  test('Work Status visibility threshold is independent of the parent floor used while a child tab is open', () => {
    // Showing the card still wants a generous transcript when it is the only
    // extra column. The child-tab clamp uses PARENT_CHAT_MIN_WIDTH (320), not
    // this 560, so a 1280 window can keep both open.
    expect(WORK_STATUS_REQUIRED_ROW_WIDTH).toBe(884);
    expect(1280 - 305).toBeGreaterThanOrEqual(WORK_STATUS_REQUIRED_ROW_WIDTH);
  });
});

const here = dirname(fileURLToPath(import.meta.url));

describe('layout wiring', () => {
  test('parent column and context panel honor the shared reservation', () => {
    const chatContainer = readFileSync(join(here, '../../components/chat/ChatContainer.tsx'), 'utf-8');
    const contextPanel = readFileSync(join(here, '../../components/layout/ContextPanel.tsx'), 'utf-8');
    const en = readFileSync(join(here, '../i18n/messages/en.ts'), 'utf-8');
    expect(chatContainer).toContain('minWidth: PARENT_CHAT_MIN_WIDTH');
    expect(chatContainer).toContain('data-parent-chat-column="true"');
    expect(contextPanel).toContain('reservedMainWidthForContextPanel');
    expect(contextPanel).toContain('clampContextPanelLayoutWidth');
    expect(contextPanel).toContain('--oc-chat-reserved');
    expect(en).toContain("'chat.workStatus.subagent.done': 'done'");
  });
});
