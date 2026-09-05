/**
 * Files surface layout: with no open editor file, show the project tree as the
 * primary pane (not the empty "No file open" editor placeholder) (#578).
 */

export type FilesPanelTreeLayoutInput = {
  hasFileTabs: boolean;
  hasOpenEditorFile: boolean;
  isFileTabActive: boolean;
};

export type FilesPanelTreeLayout =
  | { kind: 'hidden' }
  | { kind: 'tree-only' }
  | { kind: 'editor-with-tree' };

export function resolveFilesPanelTreeLayout(input: FilesPanelTreeLayoutInput): FilesPanelTreeLayout {
  if (!input.hasFileTabs || !input.isFileTabActive) {
    return { kind: 'hidden' };
  }
  if (!input.hasOpenEditorFile) {
    return { kind: 'tree-only' };
  }
  return { kind: 'editor-with-tree' };
}
