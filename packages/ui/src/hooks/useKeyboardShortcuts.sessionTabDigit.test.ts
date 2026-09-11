import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'bun:test';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'useKeyboardShortcuts.ts'), 'utf8');

test('session-tab mod+digit is not gated on isEditableEventTarget (#718)', () => {
  const start = source.indexOf('const sessionTabDigit');
  expect(start).toBeGreaterThan(-1);
  const block = source.slice(start, source.indexOf('// Capture-phase arming', start));
  expect(block).toContain('activateSessionTabByIndex');
  expect(block).toContain('switch_session_tab');
  expect(block).not.toContain('isEditableEventTarget(event.target)');
});
