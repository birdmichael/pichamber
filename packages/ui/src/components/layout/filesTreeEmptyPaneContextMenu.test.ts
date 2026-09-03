import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FILES_TREE_ROW_ATTR,
  FILES_TREE_ROW_SELECTOR,
  handleFilesTreePaneContextMenu,
  handleFilesTreeRowContextMenu,
  resolveFilesTreePaneContextMenuAction,
} from './filesTreeEmptyPaneContextMenu';

const layoutDir = dirname(fileURLToPath(import.meta.url));
const sidebarFilesTreeSource = readFileSync(join(layoutDir, 'SidebarFilesTree.tsx'), 'utf-8');
const filesViewSource = readFileSync(
  join(layoutDir, '../views/FilesView.tsx'),
  'utf-8',
);
const emptyPaneMenuSource = readFileSync(join(layoutDir, 'FilesTreeEmptyPaneMenu.tsx'), 'utf-8');

const mockEvent = (target: unknown) => {
  let prevented = false;
  return {
    event: {
      preventDefault: () => {
        prevented = true;
      },
      target,
    },
    wasPrevented: () => prevented,
  };
};

const closestTarget = (matches: Record<string, boolean>) => ({
  closest: (selector: string) => (matches[selector] ? {} : null),
});

describe('files tree empty-pane context menu (#516)', () => {
  test('empty padding preventDefaults and opens the root New file/folder menu', () => {
    const { event, wasPrevented } = mockEvent({ closest: () => null });

    expect(handleFilesTreePaneContextMenu(event, { canOpenRootMenu: true })).toBe('root-menu');
    expect(wasPrevented()).toBe(true);
  });

  test('empty padding still preventDefaults when New file/folder are unavailable', () => {
    const { event, wasPrevented } = mockEvent({ closest: () => null });

    expect(handleFilesTreePaneContextMenu(event, { canOpenRootMenu: false })).toBe('suppress');
    expect(wasPrevented()).toBe(true);
  });

  test('file-row targets leave the row menu in charge and still block Electron', () => {
    const { event, wasPrevented } = mockEvent(closestTarget({ [FILES_TREE_ROW_SELECTOR]: true }));

    expect(handleFilesTreePaneContextMenu(event, { canOpenRootMenu: true })).toBe('row');
    expect(wasPrevented()).toBe(true);
  });

  test('search inputs keep the native editable menu', () => {
    const { event, wasPrevented } = mockEvent(closestTarget({
      'input, textarea, select, [contenteditable="true"]': true,
    }));

    expect(handleFilesTreePaneContextMenu(event, { canOpenRootMenu: true })).toBe('native');
    expect(wasPrevented()).toBe(false);
  });

  test('row handler preventDefaults and stopPropagates so the pane menu does not open', () => {
    let prevented = false;
    let stopped = false;

    handleFilesTreeRowContextMenu({
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {
        stopped = true;
      },
    });

    expect(prevented).toBe(true);
    expect(stopped).toBe(true);
  });

  test('row wins over root-menu even when create actions exist', () => {
    expect(resolveFilesTreePaneContextMenuAction({
      isEditableTarget: false,
      isRowTarget: true,
      canOpenRootMenu: true,
    })).toBe('row');
  });
});

describe('files tree empty-pane wiring', () => {
  test('SidebarFilesTree uses the shared pane menu and marks file rows', () => {
    expect(sidebarFilesTreeSource).toContain('FilesTreeEmptyPaneMenu');
    expect(sidebarFilesTreeSource).toContain('handleFilesTreeRowContextMenu');
    expect(sidebarFilesTreeSource).toContain(FILES_TREE_ROW_ATTR);
    expect(sidebarFilesTreeSource).toContain("handleOpenDialog('createFile'");
    expect(sidebarFilesTreeSource).toContain("handleOpenDialog('createFolder'");
  });

  test('FilesView uses the shared pane menu on desktop and marks file rows', () => {
    expect(filesViewSource).toContain('FilesTreeEmptyPaneMenu');
    expect(filesViewSource).toContain('handleFilesTreeRowContextMenu');
    expect(filesViewSource).toContain(FILES_TREE_ROW_ATTR);
    expect(filesViewSource).toContain('enabled={!isMobile}');
  });

  test('empty-pane menu reuses New File / New Folder copy', () => {
    expect(emptyPaneMenuSource).toContain('sidebarFilesTree.menu.newFile');
    expect(emptyPaneMenuSource).toContain('sidebarFilesTree.menu.newFolder');
    expect(emptyPaneMenuSource).toContain('handleFilesTreePaneContextMenu');
  });
});
