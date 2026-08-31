import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'bun:test';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'useKeyboardShortcuts.ts'), 'utf8');

function extractCallback(name: string): string {
  const start = source.indexOf(`const ${name} = React.useCallback`);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('}, [panelDirectoryKey]);', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

test('Ctrl+J terminal toggles use the context-panel key, not DirectoryStore', () => {
  const toggle = extractCallback('toggleTerminalSurface');
  const expand = extractCallback('toggleTerminalSurfaceExpanded');

  for (const body of [toggle, expand]) {
    expect(body).toContain('if (!panelDirectoryKey) return');
    expect(body).toContain('normalizeContextPanelDirectoryKey(panelDirectoryKey)');
    expect(body).not.toContain('currentShortcutDirectory');
    expect(body).not.toContain('useDirectoryStore');
  }

  const digitStart = source.indexOf('switchSurfaceDigit !== null');
  const digit = source.slice(digitStart, source.indexOf('open_model_selector', digitStart));
  expect(digit).toContain('if (isEditableEventTarget(e.target)) return');
  expect(digit).toContain('if (state.isMobile || !panelDirectoryKey)');
  expect(digit).toContain('normalizeContextPanelDirectoryKey(panelDirectoryKey)');
});
