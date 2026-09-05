import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('Files panel tree-only wiring (#578)', () => {
  test('ContextPanel renders SidebarFilesTree full-width when no editor file is open', () => {
    const panel = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../components/layout/ContextPanel.tsx'),
      'utf8',
    );
    expect(panel).toContain('resolveFilesPanelTreeLayout');
    expect(panel).toContain("kind === 'tree-only'");
    expect(panel).toContain('<SidebarFilesTree />');
  });

  test('Open Files menu/shortcuts bind to the context-panel directory key', () => {
    const menu = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../hooks/useMenuActions.ts'),
      'utf8',
    );
    const shortcuts = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../hooks/useKeyboardShortcuts.ts'),
      'utf8',
    );
    expect(menu).toContain('readContextPanelDirectoryKey');
    expect(menu).toContain("case 'open-right-sidebar-files'");
    expect(shortcuts).toContain('panelDirectoryKey || currentDirectory');
    expect(shortcuts).toContain('open_right_sidebar_files');
  });
});
