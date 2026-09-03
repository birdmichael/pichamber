/**
 * Regression guard for Markdown preview find Escape vs Files panel close.
 *
 * ContextPanel captures Escape and closes the panel. While the Markdown
 * preview find bar is open, Escape must close only the find bar (same as X)
 * and must not close Files. Terminal Escape (issue #2644) still skips first.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contextPanelSource = readFileSync(join(__dirname, '..', 'ContextPanel.tsx'), 'utf-8');
const searchSource = readFileSync(
  join(__dirname, '..', '..', 'views', 'MarkdownPreviewSearch.tsx'),
  'utf-8',
);

describe('issue #414: Escape with Markdown preview find open must not close the context panel', () => {
  test('the context panel still captures Escape at the panel level', () => {
    expect(contextPanelSource).toContain('onKeyDownCapture={handlePanelKeyDownCapture}');
  });

  test('the capture handler skips closing when preview find is open, after the terminal skip', () => {
    const start = contextPanelSource.indexOf('const handlePanelKeyDownCapture = React.useCallback(');
    expect(start).toBeGreaterThan(-1);
    const end = contextPanelSource.indexOf('}, [handleClose]);', start);
    expect(end).toBeGreaterThan(start);
    const handler = contextPanelSource.slice(start, end);

    expect(handler).toContain("event.key !== 'Escape'");
    expect(handler).toContain('isTerminalEventTarget(event.target)');
    expect(handler).toContain('[data-md-preview-find]');
    expect(handler).toContain('event.preventDefault()');
    expect(handler).toContain('event.stopPropagation()');
    expect(handler).toContain('handleClose()');

    const terminalIndex = handler.indexOf('isTerminalEventTarget(event.target)');
    const findIndex = handler.indexOf('[data-md-preview-find]');
    const preventIndex = handler.indexOf('event.preventDefault()');
    expect(terminalIndex).toBeGreaterThan(-1);
    expect(findIndex).toBeGreaterThan(terminalIndex);
    expect(preventIndex).toBeGreaterThan(findIndex);
  });

  test('the find widget consumes Escape on window capture so the panel never sees it', () => {
    expect(searchSource).toContain('data-md-preview-find');
    expect(searchSource).toContain("window.addEventListener('keydown', handleWindowKeyDown, { capture: true })");
    expect(searchSource).toContain("window.removeEventListener('keydown', handleWindowKeyDown, { capture: true })");
  });
});
