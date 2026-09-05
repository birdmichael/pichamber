import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainSource = readFileSync(join(__dirname, 'useKeyboardShortcuts.ts'), 'utf-8');
const miniSource = readFileSync(join(__dirname, 'useMiniChatKeyboardShortcuts.ts'), 'utf-8');

test('arms shortcut leaders in capture so composer CodeMirror cannot eat Ctrl+K', () => {
  expect(mainSource).toContain("window.addEventListener('keydown', handleKeyDown, true)");
  expect(mainSource).toContain("window.removeEventListener('keydown', handleKeyDown, true)");
  expect(mainSource).toContain('event.stopPropagation()');
  // Prefix completion stays capture-first; arming follows on the same phase.
  const prefixIdx = mainSource.indexOf('handleActivePrefixKeyDownCapture');
  const armIdx = mainSource.indexOf("window.addEventListener('keydown', handleKeyDown, true)");
  expect(prefixIdx).toBeGreaterThan(-1);
  expect(armIdx).toBeGreaterThan(prefixIdx);
});

test('Mini Chat also arms leaders in capture with stopPropagation', () => {
  expect(miniSource).toContain("window.addEventListener('keydown', handleKeyDown, true)");
  expect(miniSource).toContain('event.stopPropagation()');
});
