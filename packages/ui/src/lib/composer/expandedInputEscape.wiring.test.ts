import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('expanded input Esc wiring (#574)', () => {
  test('ChatInput and shortcut capture both collapse focus mode on Escape', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
    const chatInput = readFileSync(join(root, 'components/chat/ChatInput.tsx'), 'utf8');
    const shortcuts = readFileSync(join(root, 'hooks/useKeyboardShortcuts.ts'), 'utf8');
    const popups = readFileSync(
      join(root, 'components/chat/composer/ui/ComposerAutocompletePopups.tsx'),
      'utf8',
    );
    expect(chatInput).toContain('shouldCollapseExpandedInputOnEscape');
    expect(chatInput).toContain('data-composer-shell');
    expect(shortcuts).toContain('shouldCollapseExpandedInputOnEscape');
    expect(shortcuts).toContain("setExpandedInput(false)");
    expect(popups).toContain('data-composer-autocomplete="true"');
  });
});
