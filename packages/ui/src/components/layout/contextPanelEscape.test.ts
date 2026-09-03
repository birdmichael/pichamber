import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import { shouldYieldFilesPanelEscape } from './contextPanelEscape';

const rootWith = (hit: string | null): ParentNode => ({
  querySelector: (selector: string) => {
    if (!hit) return null;
    const parts = selector.split(',').map((part) => part.trim());
    return parts.includes(hit) ? {} : null;
  },
} as unknown as ParentNode);

const targetClosest = (hit: string | null): EventTarget => ({
  closest: (selector: string) => {
    if (!hit) return null;
    const parts = selector.split(',').map((part) => part.trim());
    return parts.includes(hit) ? {} : null;
  },
} as unknown as EventTarget);

describe('shouldYieldFilesPanelEscape', () => {
  test('does not yield when no Files overlay is open', () => {
    expect(shouldYieldFilesPanelEscape({
      target: targetClosest(null),
      root: rootWith(null),
    })).toBe(false);
  });

  test('yields while a Files tree context menu popup is open', () => {
    expect(shouldYieldFilesPanelEscape({
      target: targetClosest(null),
      root: rootWith('[data-slot="dropdown-menu-content"][data-open]'),
    })).toBe(true);
  });

  test('does not treat a mounted but closed menu popup as open', () => {
    expect(shouldYieldFilesPanelEscape({
      target: targetClosest(null),
      root: rootWith('[data-slot="dropdown-menu-content"]'),
    })).toBe(false);
  });

  test('yields when Escape is targeted at the open menu', () => {
    expect(shouldYieldFilesPanelEscape({
      target: targetClosest('[data-slot="dropdown-menu-content"]'),
      root: rootWith(null),
    })).toBe(true);
    expect(shouldYieldFilesPanelEscape({
      target: targetClosest('[role="menu"]'),
      root: rootWith(null),
    })).toBe(true);
    expect(shouldYieldFilesPanelEscape({
      target: targetClosest('[role="menuitem"]'),
      root: rootWith(null),
    })).toBe(true);
  });

  test('yields while a Create File or Delete dialog is open', () => {
    expect(shouldYieldFilesPanelEscape({
      target: targetClosest(null),
      root: rootWith('[data-slot="dialog-content"][data-open]'),
    })).toBe(true);
    expect(shouldYieldFilesPanelEscape({
      target: targetClosest('[role="dialog"]'),
      root: rootWith(null),
    })).toBe(true);
  });

  test('does not treat a mounted but closed dialog popup as open', () => {
    expect(shouldYieldFilesPanelEscape({
      target: targetClosest(null),
      root: rootWith('[data-slot="dialog-content"]'),
    })).toBe(false);
  });

  test('does not yield for the Files editor find bar (issue #512)', () => {
    expect(shouldYieldFilesPanelEscape({
      target: targetClosest('[data-md-preview-find]'),
      root: rootWith('[data-md-preview-find]'),
    })).toBe(false);
  });
});

describe('ContextPanel Escape capture yields to Files overlays', () => {
  test('the capture handler calls shouldYieldFilesPanelEscape before closing', () => {
    const contextPanelSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'ContextPanel.tsx'),
      'utf-8',
    );
    expect(contextPanelSource).toContain("from './contextPanelEscape'");
    expect(contextPanelSource).toContain('shouldYieldFilesPanelEscape');

    const start = contextPanelSource.indexOf('const handlePanelKeyDownCapture = React.useCallback(');
    expect(start).toBeGreaterThan(-1);
    const end = contextPanelSource.indexOf('}, [handleClose]);', start);
    expect(end).toBeGreaterThan(start);
    const handler = contextPanelSource.slice(start, end);

    const terminalIndex = handler.indexOf('isTerminalEventTarget(event.target)');
    const yieldIndex = Math.max(
      handler.indexOf('shouldYieldFilesOverlayEscape'),
      handler.indexOf('shouldYieldFilesFindEscape'),
      handler.indexOf('shouldYieldFilesPanelEscape'),
    );
    const preventIndex = handler.indexOf('event.preventDefault()');
    expect(terminalIndex).toBeGreaterThan(-1);
    expect(yieldIndex).toBeGreaterThan(terminalIndex);
    expect(preventIndex).toBeGreaterThan(yieldIndex);
    expect(handler).toContain('handleClose()');
  });
});
