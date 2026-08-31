import { describe, expect, test } from 'bun:test';

import {
  EDITOR_PANE_MIN_WIDTH,
  EDITOR_SPLIT_HANDLE_WIDTH,
  EDITOR_TREE_DEFAULT_WIDTH,
  EDITOR_TREE_MIN_WIDTH,
  clampEditorTreeWidth,
} from './editorSplit';

describe('clampEditorTreeWidth', () => {
  test('keeps the stored tree width on a wide Files panel', () => {
    expect(clampEditorTreeWidth(EDITOR_TREE_DEFAULT_WIDTH, 800)).toBe(EDITOR_TREE_DEFAULT_WIDTH);
  });

  test('shrinks the tree so the editor keeps a readable min width on a tight panel', () => {
    const panel = 300;
    const tree = clampEditorTreeWidth(240, panel);
    expect(tree).toBe(panel - EDITOR_SPLIT_HANDLE_WIDTH - EDITOR_PANE_MIN_WIDTH);
    expect(tree).toBeLessThan(EDITOR_TREE_MIN_WIDTH);
    expect(panel - EDITOR_SPLIT_HANDLE_WIDTH - tree).toBe(EDITOR_PANE_MIN_WIDTH);
  });

  test('collapses the tree when the panel cannot fit the editor min width', () => {
    expect(clampEditorTreeWidth(240, EDITOR_PANE_MIN_WIDTH)).toBe(0);
  });
});

describe('Files panel wiring', () => {
  test('ContextPanel clamps the tree against the panel and keeps an editor min width', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const panel = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../components/layout/ContextPanel.tsx'),
      'utf8',
    );
    expect(panel).toContain('clampEditorTreeWidth');
    expect(panel).toContain('minWidth: EDITOR_PANE_MIN_WIDTH');
    expect(panel).toContain('panelWidth={width}');
  });
});
