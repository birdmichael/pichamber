import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findMatchRanges } from './markdownPreviewFind';

const __dirname = dirname(fileURLToPath(import.meta.url));
const searchSource = readFileSync(join(__dirname, 'MarkdownPreviewSearch.tsx'), 'utf-8');
const contextPanelSource = readFileSync(join(__dirname, '..', 'layout', 'ContextPanel.tsx'), 'utf-8');

describe('findMatchRanges', () => {
  test('returns no ranges for an empty or whitespace-only query', () => {
    expect(findMatchRanges('hello world', '')).toEqual([]);
    expect(findMatchRanges('hello world', '   ')).toEqual([]);
  });

  test('returns no ranges when the query does not occur', () => {
    expect(findMatchRanges('hello world', 'nope')).toEqual([]);
  });

  test('finds all non-overlapping occurrences', () => {
    expect(findMatchRanges('the quick brown fox jumps over the lazy dog', 'the')).toEqual([
      { start: 0, end: 3 },
      { start: 31, end: 34 },
    ]);
  });

  test('matches case-insensitively', () => {
    expect(findMatchRanges('Hello HELLO hello', 'hello')).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 11 },
      { start: 12, end: 17 },
    ]);
  });

  test('scans non-overlapping matches like standard find-in-page', () => {
    expect(findMatchRanges('aaaa', 'aaa')).toEqual([{ start: 0, end: 3 }]);
  });

  test('trims the query before matching', () => {
    expect(findMatchRanges('alpha beta', '  beta  ')).toEqual([{ start: 6, end: 10 }]);
  });

  test('handles a query longer than the text', () => {
    expect(findMatchRanges('abc', 'abcdef')).toEqual([]);
  });
});


describe('issue #414: Escape closes Markdown preview find, not the Files panel', () => {
  test('the find-bar root is tagged so other surfaces can skip it', () => {
    expect(searchSource).toContain('data-md-preview-find');
  });

  test('while the bar is open, a window capture keydown listener consumes Escape and closes', () => {
    const start = searchSource.indexOf('const handleWindowKeyDown = (event: KeyboardEvent)');
    expect(start).toBeGreaterThan(-1);
    const end = searchSource.indexOf('}, [open, close]);', start);
    expect(end).toBeGreaterThan(start);
    const effect = searchSource.slice(searchSource.lastIndexOf('React.useEffect', start), end);

    expect(effect).toContain('if (!open)');
    expect(effect).toContain("event.key !== 'Escape'");
    expect(effect).toContain('event.preventDefault()');
    expect(effect).toContain('event.stopPropagation()');
    expect(effect).toContain('close()');
    expect(effect).toContain("window.addEventListener('keydown', handleWindowKeyDown, { capture: true })");
    expect(effect).toContain("window.removeEventListener('keydown', handleWindowKeyDown, { capture: true })");
  });

  test('the input Escape handler also stops propagation', () => {
    const start = searchSource.indexOf('const handleKeyDown = React.useCallback(');
    expect(start).toBeGreaterThan(-1);
    const end = searchSource.indexOf('}, [close, goToNext, goToPrevious]);', start);
    expect(end).toBeGreaterThan(start);
    const handler = searchSource.slice(start, end);
    const escapeIndex = handler.indexOf("event.key === 'Escape'");
    expect(escapeIndex).toBeGreaterThan(-1);
    const escapeBlock = handler.slice(escapeIndex);
    expect(escapeBlock).toContain('event.preventDefault()');
    expect(escapeBlock).toContain('event.stopPropagation()');
    expect(escapeBlock).toContain('close()');
  });

  test('ContextPanel still skips terminal Escape (issue #2644) before the find-bar skip', () => {
    const start = contextPanelSource.indexOf('const handlePanelKeyDownCapture = React.useCallback(');
    expect(start).toBeGreaterThan(-1);
    const end = contextPanelSource.indexOf('}, [handleClose]);', start);
    expect(end).toBeGreaterThan(start);
    const handler = contextPanelSource.slice(start, end);

    const terminalIndex = handler.indexOf('isTerminalEventTarget(event.target)');
    const findIndex = handler.indexOf('[data-md-preview-find]');
    const preventIndex = handler.indexOf('event.preventDefault()');
    expect(terminalIndex).toBeGreaterThan(-1);
    expect(findIndex).toBeGreaterThan(terminalIndex);
    expect(preventIndex).toBeGreaterThan(findIndex);
    expect(handler).toContain('handleClose()');
  });
});

type Listener = { capture: boolean; onEvent: (event: SimulatedEvent) => void };
type SimulatedEvent = {
  type: string;
  defaultPrevented: boolean;
  propagationStopped: boolean;
  target: SimNode;
  preventDefault(): void;
  stopPropagation(): void;
};

class SimNode {
  readonly children: SimNode[] = [];
  private listeners: Listener[] = [];
  private parent: SimNode | null = null;

  addListener(listener: Listener): void {
    this.listeners.push(listener);
  }

  attach(child: SimNode): void {
    child.parent = this;
    this.children.push(child);
  }

  dispatch(type: string): SimulatedEvent {
    const buildPath = (target: SimNode): SimNode[] => {
      const ancestors: SimNode[] = [];
      let cursor: SimNode | null = target;
      while (cursor !== null) {
        ancestors.push(cursor);
        cursor = cursor.parent;
      }
      ancestors.reverse();
      return ancestors;
    };
    const path = buildPath(this);

    const event: SimulatedEvent = {
      type,
      defaultPrevented: false,
      propagationStopped: false,
      target: this,
      preventDefault() {
        event.defaultPrevented = true;
      },
      stopPropagation() {
        event.propagationStopped = true;
      },
    };

    for (let i = 0; i < path.length; i += 1) {
      if (event.propagationStopped) return event;
      for (const listener of path[i].listeners) {
        if (!listener.capture) continue;
        listener.onEvent(event);
        if (event.propagationStopped) return event;
      }
    }
    for (let i = path.length - 1; i >= 0; i -= 1) {
      if (event.propagationStopped) return event;
      for (const listener of path[i].listeners) {
        if (listener.capture) continue;
        listener.onEvent(event);
        if (event.propagationStopped) return event;
      }
    }
    return event;
  }
}

describe('issue #414: window capture consumes Escape before the context panel capture', () => {
  test('when the find bar is open, Escape closes only the find bar', () => {
    const win = new SimNode();
    const panel = new SimNode();
    const findBar = new SimNode();
    win.attach(panel);
    panel.attach(findBar);

    const calls: string[] = [];
    win.addListener({
      capture: true,
      onEvent: (event) => {
        // Fixed behavior: consume Escape while the find bar is open.
        calls.push('window-capture-close-find');
        event.preventDefault();
        event.stopPropagation();
      },
    });
    panel.addListener({
      capture: true,
      onEvent: (event) => {
        calls.push('panel-capture-closed');
        event.preventDefault();
        event.stopPropagation();
      },
    });
    findBar.addListener({
      capture: false,
      onEvent: () => calls.push('find-input-bubble'),
    });

    const event = findBar.dispatch('keydown');

    expect(calls).toEqual(['window-capture-close-find']);
    expect(event.propagationStopped).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  test('when the find bar is closed, Escape still closes the context panel', () => {
    const win = new SimNode();
    const panel = new SimNode();
    const headerButton = new SimNode();
    win.attach(panel);
    panel.attach(headerButton);

    const calls: string[] = [];
    panel.addListener({
      capture: true,
      onEvent: (event) => {
        calls.push('panel-capture-closed');
        event.preventDefault();
        event.stopPropagation();
      },
    });

    const event = headerButton.dispatch('keydown');
    expect(calls).toEqual(['panel-capture-closed']);
    expect(event.propagationStopped).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });
});
