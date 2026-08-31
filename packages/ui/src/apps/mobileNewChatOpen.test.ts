import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { shouldStartMobileNewChatOnPointerDown } from './mobileNewChatOpen';

const sheetSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'MobileSessionsSheet.tsx'),
  'utf8',
);

const mouse = { button: 0, pointerType: 'mouse' as const };

describe('mobile sessions + new chat open', () => {
  test('primary mouse, touch, and pen may start a new chat immediately', () => {
    expect(shouldStartMobileNewChatOnPointerDown(mouse)).toBe(true);
    expect(shouldStartMobileNewChatOnPointerDown({ button: 0, pointerType: 'touch' })).toBe(true);
    expect(shouldStartMobileNewChatOnPointerDown({ button: 0, pointerType: 'pen' })).toBe(true);
  });

  test('non-primary buttons wait for a later click', () => {
    expect(shouldStartMobileNewChatOnPointerDown({ button: 1, pointerType: 'mouse' })).toBe(false);
    expect(shouldStartMobileNewChatOnPointerDown({ button: 2, pointerType: 'mouse' })).toBe(false);
  });

  test('the sheet starts a projectless draft on pointerdown and still closes on click', () => {
    expect(sheetSource).toContain('shouldStartMobileNewChatOnPointerDown(event)');
    expect(sheetSource).toContain('openNewSessionDraft()');
    expect(sheetSource).toContain('onOpenChange(false)');
    expect(sheetSource).toContain("event.currentTarget.dataset.mobileNewChatArmed = '1'");
    expect(sheetSource).not.toContain('readInheritedNewSessionDraftOptions');
    expect(sheetSource).toMatch(
      /const handleStartNewChat = \(\) => \{[\s\S]*?openNewSessionDraft\(\);[\s\S]*?onOpenChange\(false\);/,
    );
  });
});
