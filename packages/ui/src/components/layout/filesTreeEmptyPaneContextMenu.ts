/**
 * Empty Files-tree padding has no row handler, so Electron's default
 * context menu (Select All / Inspect Element) would show. The pane always
 * preventDefaults unless the target is an editable field (search). File rows
 * keep their own in-app menu and are ignored here.
 */

export const FILES_TREE_ROW_ATTR = 'data-files-tree-row';
export const FILES_TREE_ROW_SELECTOR = `[${FILES_TREE_ROW_ATTR}]`;
const FILES_TREE_EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"]';

type FilesTreePaneContextMenuAction = 'native' | 'row' | 'root-menu' | 'suppress';

type ClosestTarget = {
  closest: (selector: string) => unknown;
};

type ContextMenuLikeEvent = {
  preventDefault: () => void;
  target: unknown;
};

const hasClosest = (target: unknown): target is ClosestTarget => {
  if (typeof target !== 'object' || target == null) return false;
  return typeof (target as { closest?: unknown }).closest === 'function';
};

const isFilesTreeRowContextMenuTarget = (target: unknown): boolean => {
  if (!hasClosest(target)) return false;
  return Boolean(target.closest(FILES_TREE_ROW_SELECTOR));
};

const isFilesTreeEditableContextMenuTarget = (target: unknown): boolean => {
  if (!hasClosest(target)) return false;
  return Boolean(target.closest(FILES_TREE_EDITABLE_SELECTOR));
};

export const resolveFilesTreePaneContextMenuAction = (input: {
  isEditableTarget: boolean;
  isRowTarget: boolean;
  canOpenRootMenu: boolean;
}): FilesTreePaneContextMenuAction => {
  if (input.isEditableTarget) return 'native';
  if (input.isRowTarget) return 'row';
  if (input.canOpenRootMenu) return 'root-menu';
  return 'suppress';
};

/** Block the native menu on empty tree padding. File rows and inputs are left to their own handlers. */
export const handleFilesTreePaneContextMenu = (
  event: ContextMenuLikeEvent,
  options: { canOpenRootMenu: boolean },
): FilesTreePaneContextMenuAction => {
  const action = resolveFilesTreePaneContextMenuAction({
    isEditableTarget: isFilesTreeEditableContextMenuTarget(event.target),
    isRowTarget: isFilesTreeRowContextMenuTarget(event.target),
    canOpenRootMenu: options.canOpenRootMenu,
  });
  if (action !== 'native') {
    event.preventDefault();
  }
  return action;
};

/** File-row (and search-hit) right-click: never leak through to Electron or the empty-pane menu. */
export const handleFilesTreeRowContextMenu = (event: {
  preventDefault: () => void;
  stopPropagation: () => void;
}): void => {
  event.preventDefault();
  event.stopPropagation();
};
