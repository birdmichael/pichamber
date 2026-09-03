/**
 * Regression guard for issue #512: Esc on the Files editor Find/Replace bar
 * must close only the bar (same as ×), not the Files panel.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const filesViewSource = readFileSync(join(__dirname, 'FilesView.tsx'), 'utf-8');

describe('issue #512: Escape with Files editor find open must not close Files', () => {
  test('FilesView keeps searchOpen on the editor and syncs isSearchOpen', () => {
    expect(filesViewSource).toContain('enableSearch');
    expect(filesViewSource).toContain('searchOpen={isSearchOpen}');
    expect(filesViewSource).toContain('onSearchOpenChange={setIsSearchOpen}');
  });

  test('while the find bar is open, a window capture listener consumes Escape and closes only the bar', () => {
    const start = filesViewSource.indexOf('const [isSearchOpen, setIsSearchOpen]');
    expect(start).toBeGreaterThan(-1);
    const end = filesViewSource.indexOf('}, [isSearchOpen]);', start);
    expect(end).toBeGreaterThan(start);
    const effect = filesViewSource.slice(start, end);

    expect(effect).toContain('if (!isSearchOpen)');
    expect(effect).toContain("event.key !== 'Escape'");
    expect(effect).toContain('event.preventDefault()');
    expect(effect).toContain('event.stopPropagation()');
    expect(effect).toContain('setIsSearchOpen(false)');
    expect(effect).toContain("window.addEventListener('keydown', handleWindowKeyDown, { capture: true })");
    expect(effect).toContain("window.removeEventListener('keydown', handleWindowKeyDown, { capture: true })");
  });

  test('Ctrl/Cmd+F still opens the in-app find bar rather than Chromium find', () => {
    expect(filesViewSource).toContain('find_in_file:');
    expect(filesViewSource).toContain('setIsSearchOpen(true)');
    expect(filesViewSource).toContain('enableSearch');
  });

  test('the search Escape effect does not close the Files panel', () => {
    const start = filesViewSource.indexOf('const [isSearchOpen, setIsSearchOpen]');
    const end = filesViewSource.indexOf('}, [isSearchOpen]);', start);
    const effect = filesViewSource.slice(start, end);
    expect(effect).not.toContain('closeContextPanel');
    expect(effect).not.toContain('handleClose');
    expect(effect).not.toContain('closeMainSurfaces');
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

describe('issue #512: window capture consumes Escape before the context panel capture', () => {
  test('when the editor find bar is open, Escape closes only the find bar', () => {
    const win = new SimNode();
    const panel = new SimNode();
    const findBar = new SimNode();
    win.attach(panel);
    panel.attach(findBar);

    const calls: string[] = [];
    win.addListener({
      capture: true,
      onEvent: (event) => {
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

    const event = findBar.dispatch('keydown');

    expect(calls).toEqual(['window-capture-close-find']);
    expect(event.propagationStopped).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  test('when the find bar is closed, Escape still closes the context panel', () => {
    const panel = new SimNode();
    const headerButton = new SimNode();
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
