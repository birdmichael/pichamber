import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'bun:test';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'useKeyboardShortcuts.ts'), 'utf8');

test('Escape on Archive, Scheduled, and Worktrees uses closeMainSurfaces after nested yield', () => {
  const handlerStart = source.indexOf('const handleEscapeKeyDownCapture');
  const handler = source.slice(handlerStart, source.indexOf('const handleActivePrefixKeyDownCapture', handlerStart));

  expect(handler).toContain("target?.closest('[role=\"dialog\"]')");
  expect(handler).toContain('isTerminalEventTarget(target)');
  expect(handler).toContain('dropdownOpen');
  expect(handler.indexOf("target?.closest('[role=\"dialog\"]')")).toBeLessThan(handler.indexOf('shouldYieldFilesPanelEscape'));
  expect(handler.indexOf('shouldYieldFilesPanelEscape')).toBeLessThan(handler.indexOf('shouldCloseMainSurfaceOnEscape'));
  expect(handler.indexOf('shouldCloseMainSurfaceOnEscape')).toBeLessThan(handler.indexOf('closeMainSurfaces'));
  expect(handler).toContain('isMultiRunLauncherOpen');
  expect(handler).toContain('multiRunCompareGroup');
});
