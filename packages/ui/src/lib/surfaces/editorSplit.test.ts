import { describe, expect, test } from 'bun:test';

import {
  EDITOR_PANE_HARD_FLOOR,
  EDITOR_PANE_MIN_WIDTH,
  EDITOR_SPLIT_HANDLE_WIDTH,
  EDITOR_TREE_DEFAULT_WIDTH,
  EDITOR_TREE_MIN_WIDTH,
  clampEditorTreeWidth,
  editorPaneWidthForTree,
  editorTreeWidthFromDrag,
} from './editorSplit';

describe('clampEditorTreeWidth', () => {
  test('keeps the stored tree width on a wide Files panel', () => {
    expect(clampEditorTreeWidth(EDITOR_TREE_DEFAULT_WIDTH, 800)).toBe(EDITOR_TREE_DEFAULT_WIDTH);
  });

  test('on a typical Files panel, names stay visible and the editor is not crushed', () => {
    const panel = 380;
    const tree = clampEditorTreeWidth(EDITOR_TREE_DEFAULT_WIDTH, panel);
    expect(tree).toBeGreaterThanOrEqual(EDITOR_TREE_MIN_WIDTH);
    expect(editorPaneWidthForTree(tree, panel)).toBeGreaterThanOrEqual(EDITOR_PANE_MIN_WIDTH);
  });

  test('a ~300px panel keeps a readable tree with a splitter drag range, not a ~60px icon strip', () => {
    const panel = 300;
    const tree = clampEditorTreeWidth(240, panel);
    expect(tree).toBeGreaterThanOrEqual(EDITOR_TREE_MIN_WIDTH);
    expect(tree).toBeGreaterThan(80);
    expect(editorPaneWidthForTree(tree, panel)).toBeGreaterThanOrEqual(EDITOR_PANE_HARD_FLOOR);
    expect(editorPaneWidthForTree(tree, panel)).toBeGreaterThan(55);

    const shrink = editorTreeWidthFromDrag(tree, 200, 240, panel);
    expect(shrink).toBeLessThan(tree);
    expect(shrink).toBeGreaterThanOrEqual(Math.min(EDITOR_TREE_MIN_WIDTH, tree));

    const widen = editorTreeWidthFromDrag(EDITOR_TREE_MIN_WIDTH, 200, 160, panel);
    expect(widen).toBeGreaterThan(EDITOR_TREE_MIN_WIDTH);
  });

  test('never collapses the tree to zero when the panel still has room for names', () => {
    const tree = clampEditorTreeWidth(240, EDITOR_PANE_MIN_WIDTH + EDITOR_SPLIT_HANDLE_WIDTH);
    expect(tree).toBeGreaterThan(0);
    expect(editorPaneWidthForTree(tree, EDITOR_PANE_MIN_WIDTH + EDITOR_SPLIT_HANDLE_WIDTH)).toBeGreaterThanOrEqual(
      EDITOR_PANE_HARD_FLOOR,
    );
  });

  test('keeps the editor above the ~55px line-number crush on a tight panel', () => {
    const panel = 260;
    const tree = clampEditorTreeWidth(240, panel);
    expect(editorPaneWidthForTree(tree, panel)).toBeGreaterThan(55);
    expect(editorPaneWidthForTree(tree, panel)).toBeGreaterThanOrEqual(EDITOR_PANE_HARD_FLOOR);
  });
});

describe('editorTreeWidthFromDrag', () => {
  test('widens the tree when the left-edge handle moves left', () => {
    expect(editorTreeWidthFromDrag(160, 400, 360, 800)).toBe(200);
  });

  test('narrows the tree when the handle moves right', () => {
    expect(editorTreeWidthFromDrag(240, 400, 440, 800)).toBe(200);
  });
});

describe('Files panel wiring', () => {
  test('ContextPanel clamps against the measured files row and does not CSS-minWidth the editor', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const panel = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../components/layout/ContextPanel.tsx'),
      'utf8',
    );
    expect(panel).toContain('clampEditorTreeWidth');
    expect(panel).toContain('editorTreeWidthFromDrag');
    expect(panel).toContain('ResizeObserver');
    expect(panel).toContain('parent.clientWidth');
    expect(panel).not.toContain('minWidth: EDITOR_PANE_MIN_WIDTH');
    expect(panel).toContain("window.addEventListener('pointermove'");
  });
});
