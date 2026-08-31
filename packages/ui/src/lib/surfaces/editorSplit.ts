/** Tree column can shrink below the stored default when the Files panel is narrow. */
export const EDITOR_TREE_MIN_WIDTH = 80;
export const EDITOR_TREE_MAX_WIDTH = 480;
export const EDITOR_TREE_DEFAULT_WIDTH = 240;
/** Keep the editor (not just line numbers) readable beside the tree. */
export const EDITOR_PANE_MIN_WIDTH = 240;
export const EDITOR_SPLIT_HANDLE_WIDTH = 8;

/**
 * Split the Files panel so the editor keeps a usable width.
 * When the panel is tight, the tree shrinks first instead of crushing the editor to ~55px.
 */
export const clampEditorTreeWidth = (treeWidth: number, panelWidth: number): number => {
  const panel = Number.isFinite(panelWidth) ? Math.max(0, panelWidth) : 0;
  const available = Math.max(0, panel - EDITOR_SPLIT_HANDLE_WIDTH);
  const maxTree = Math.max(0, available - EDITOR_PANE_MIN_WIDTH);
  const minTree = Math.min(EDITOR_TREE_MIN_WIDTH, maxTree);
  const desired = Number.isFinite(treeWidth) ? Math.round(treeWidth) : EDITOR_TREE_DEFAULT_WIDTH;
  return Math.min(EDITOR_TREE_MAX_WIDTH, Math.min(maxTree, Math.max(minTree, desired)));
};
