import { describe, expect, test } from 'bun:test';

import {
  FILES_FIND_BAR_SELECTOR,
  isFilesFindBarOpen,
  shouldYieldFilesPanelEscape,
} from './files-panel-escape';

const closedPanel = {
  querySelector: () => null,
} as unknown as ParentNode;

const outsideTarget = {
  closest: () => null,
} as unknown as Element;

describe('shouldYieldFilesPanelEscape', () => {
  test('yields when the event target is inside the editor find bar', () => {
    const target = {
      closest: (selector: string) => (selector.includes('.cm-search') ? {} : null),
    } as unknown as Element;

    expect(shouldYieldFilesPanelEscape({ target }, closedPanel)).toBe(true);
    expect(isFilesFindBarOpen(target, closedPanel)).toBe(true);
  });

  test('yields when the Files panel contains an editor find bar even if focus is elsewhere', () => {
    const panel = {
      querySelector: (selector: string) => (selector.includes('.cm-search') ? {} : null),
    } as unknown as ParentNode;

    expect(shouldYieldFilesPanelEscape({ target: outsideTarget }, panel)).toBe(true);
  });

  test('yields for Markdown preview find (same first-Esc layering as the editor bar)', () => {
    const target = {
      closest: (selector: string) => (
        selector.includes('[data-md-preview-find]') ? {} : null
      ),
    } as unknown as Element;

    expect(shouldYieldFilesPanelEscape({ target }, closedPanel)).toBe(true);
  });

  test('does not yield when no find bar is open', () => {
    expect(shouldYieldFilesPanelEscape({ target: outsideTarget }, closedPanel)).toBe(false);
    expect(shouldYieldFilesPanelEscape({ target: null }, null)).toBe(false);
  });

  test('does not yield for a tree context menu (issue #517 is out of scope)', () => {
    const target = {
      closest: (selector: string) => (
        selector.includes('[role="menu"]') || selector.includes('[data-slot="context-menu"]')
          ? {}
          : null
      ),
    } as unknown as Element;

    expect(FILES_FIND_BAR_SELECTOR).not.toContain('[role="menu"]');
    expect(shouldYieldFilesPanelEscape({ target }, closedPanel)).toBe(false);
  });
});
