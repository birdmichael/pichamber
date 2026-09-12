/**
 * iPad / tablet chat surface contract after glass floating composer (#760).
 *
 * Capacitor + tablet layout sets ChatInput alwaysExpanded (full composer, not
 * the phone pill). That local shell state must NOT raise UIStore.isExpandedInput:
 * ChatContainer treats isExpandedInput as "focus mode" and hides the transcript
 * (opacity-0). Hiding the timeline looks like "iPad shows no chat".
 *
 * Also lock floatingComposer = session selected && !isExpandedInput so the glass
 * footer spacer path stays active on tablet session views.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const chatInput = readFileSync(join(__dirname, '..', 'ChatInput.tsx'), 'utf-8');
const chatContainer = readFileSync(join(__dirname, '..', 'ChatContainer.tsx'), 'utf-8');
const mobileShell = readFileSync(
  join(__dirname, '..', 'composer', 'state', 'useMobileComposerShell.ts'),
  'utf-8',
);

describe('tablet composer vs floating transcript', () => {
  test('ChatInput enables alwaysExpanded on tablet layout / hardware keyboard', () => {
    expect(chatInput).toMatch(/alwaysExpanded:\s*hasHardwareKeyboard\s*\|\|\s*isTabletLayout/);
  });

  test('useMobileComposerShell never sets isExpandedInput true for alwaysExpanded', () => {
    // Only setExpandedInput(false) is allowed from the shell; forcing true would
    // blank the ChatViewport on iPad.
    const sets = [...mobileShell.matchAll(/setExpandedInput\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(sets.length).toBeGreaterThan(0);
    expect(sets.every((arg) => arg === 'false')).toBe(true);
  });

  test('ChatContainer floatingComposer is session && !expanded focus mode', () => {
    expect(chatContainer).toMatch(
      /const floatingComposer = Boolean\(currentSessionId\) && !isDesktopExpandedInput/,
    );
  });

  test('ChatViewport hides only when isDesktopExpandedInput (focus mode)', () => {
    expect(chatContainer).toMatch(
      /isDesktopExpandedInput\s*\?\s*'absolute inset-0 opacity-0 pointer-events-none'\s*:\s*'flex-1'/,
    );
  });
});
