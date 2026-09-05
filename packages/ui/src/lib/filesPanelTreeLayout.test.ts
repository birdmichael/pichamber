import { describe, expect, test } from 'bun:test';

import { resolveFilesPanelTreeLayout } from './filesPanelTreeLayout';

describe('resolveFilesPanelTreeLayout', () => {
  test('hides the Files body when file tabs are inactive', () => {
    expect(resolveFilesPanelTreeLayout({
      hasFileTabs: false,
      hasOpenEditorFile: false,
      isFileTabActive: false,
    })).toEqual({ kind: 'hidden' });
    expect(resolveFilesPanelTreeLayout({
      hasFileTabs: true,
      hasOpenEditorFile: true,
      isFileTabActive: false,
    })).toEqual({ kind: 'hidden' });
  });

  test('shows the project tree full-width when Files is open with no editor file', () => {
    expect(resolveFilesPanelTreeLayout({
      hasFileTabs: true,
      hasOpenEditorFile: false,
      isFileTabActive: true,
    })).toEqual({ kind: 'tree-only' });
  });

  test('splits editor + tree when a file is open', () => {
    expect(resolveFilesPanelTreeLayout({
      hasFileTabs: true,
      hasOpenEditorFile: true,
      isFileTabActive: true,
    })).toEqual({ kind: 'editor-with-tree' });
  });
});
