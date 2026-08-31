/** Minimum tree width that still shows filenames, not just icons (~60px). */
export const EDITOR_TREE_MIN_WIDTH = 160;
export const EDITOR_TREE_MAX_WIDTH = 480;
export const EDITOR_TREE_DEFAULT_WIDTH = 240;
/** Keep the editor readable beside the tree when the Files panel is wide enough for both mins. */
export const EDITOR_PANE_MIN_WIDTH = 160;
/**
 * Floor so a tight Files panel cannot crush the editor back to the ~55px
 * line-number strip that #367 fixed.
 */
export const EDITOR_PANE_HARD_FLOOR = 96;
export const EDITOR_SPLIT_HANDLE_WIDTH = 8;

export const filesRowAvailableWidth = (panelWidth: number): number => {
  const panel = Number.isFinite(panelWidth) ? Math.max(0, panelWidth) : 0;
  return Math.max(0, panel - EDITOR_SPLIT_HANDLE_WIDTH);
};

export const editorPaneWidthForTree = (treeWidth: number, panelWidth: number): number => {
  return Math.max(0, filesRowAvailableWidth(panelWidth) - treeWidth);
};

/**
 * Split the Files panel so filenames stay visible and the editor is not
 * crushed to line numbers. When the panel is wide, honor the stored tree
 * width. When it is tight, share leftover space instead of collapsing the
 * tree to an icon strip.
 */
export const clampEditorTreeWidth = (treeWidth: number, panelWidth: number): number => {
  const available = filesRowAvailableWidth(panelWidth);
  if (available <= 0) {
    return 0;
  }

  const desired = Number.isFinite(treeWidth) ? Math.round(treeWidth) : EDITOR_TREE_DEFAULT_WIDTH;
  const bothMinsFit = available >= EDITOR_TREE_MIN_WIDTH + EDITOR_PANE_MIN_WIDTH;
  const editorFloor = bothMinsFit ? EDITOR_PANE_MIN_WIDTH : Math.min(EDITOR_PANE_MIN_WIDTH, EDITOR_PANE_HARD_FLOOR);
  const maxTree = Math.min(EDITOR_TREE_MAX_WIDTH, Math.max(0, available - editorFloor));
  const minTree = Math.min(EDITOR_TREE_MIN_WIDTH, maxTree);
  return Math.min(maxTree, Math.max(minTree, desired));
};

/** Tree is docked on the right; dragging the left-edge handle left widens it. */
export const editorTreeWidthFromDrag = (
  startWidth: number,
  startX: number,
  clientX: number,
  panelWidth: number,
): number => clampEditorTreeWidth(startWidth + (startX - clientX), panelWidth);
