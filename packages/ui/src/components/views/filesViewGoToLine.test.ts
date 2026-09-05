import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  consumeGoToLineSubmitKey,
  isUndeliveredShortcutEventTarget,
  resolveFilesGoToLineFocus,
  shouldOpenFilesGoToLine,
  shouldOpenFilesGoToLineWithoutFocus,
} from './filesViewGoToLine';

const __dirname = dirname(fileURLToPath(import.meta.url));
const filesViewSource = readFileSync(join(__dirname, 'FilesView.tsx'), 'utf-8');
const goToLineSource = readFileSync(join(__dirname, 'GoToLineDialog.tsx'), 'utf-8');
const menuActionsSource = readFileSync(join(__dirname, '../../hooks/useMenuActions.ts'), 'utf-8');

class StubElement {
  className: string;
  parentElement: StubElement | null;
  role: string | null;
  tagName: string;

  constructor(
    tagName: string,
    options: { className?: string; parent?: StubElement | null; role?: string | null } = {},
  ) {
    this.tagName = tagName;
    this.className = options.className ?? '';
    this.parentElement = options.parent ?? null;
    this.role = options.role ?? null;
  }

  closest(selector: string): StubElement | null {
    const parts = selector.split(',').map((part) => part.trim());
    if (parts.some((part) => this.matchesPart(part))) return this;
    return this.parentElement?.closest(selector) ?? null;
  }

  contains(node: StubElement): boolean {
    let current: StubElement | null = node;
    while (current) {
      if (current === this) return true;
      current = current.parentElement;
    }
    return false;
  }

  private matchesPart(selector: string): boolean {
    if (selector.startsWith('.')) {
      return this.className.split(/\s+/).includes(selector.slice(1));
    }
    if (selector === '[role="dialog"]') {
      return this.role === 'dialog';
    }
    if (selector === '[role="textbox"]') {
      return this.role === 'textbox';
    }
    if (selector === '[contenteditable="true"]') {
      return false;
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }
}

const openFocus = {
  inDialog: false,
  inEditor: true,
  inEditorRoot: true,
  typingOutsideEditor: false,
};

describe('shouldOpenFilesGoToLine', () => {
  test('opens for an edit-mode CodeMirror caret inside the files editor', () => {
    expect(shouldOpenFilesGoToLine({
      canEdit: true,
      textViewMode: 'edit',
      isMobile: false,
      focus: openFocus,
    })).toBe(true);
  });

  test('keeps preview mode as a no-op', () => {
    expect(shouldOpenFilesGoToLine({
      canEdit: true,
      textViewMode: 'view',
      isMobile: false,
      focus: openFocus,
    })).toBe(false);
  });

  test('does not open on mobile, read-only files, dialogs, or typing outside the editor', () => {
    expect(shouldOpenFilesGoToLine({
      canEdit: true,
      textViewMode: 'edit',
      isMobile: true,
      focus: openFocus,
    })).toBe(false);
    expect(shouldOpenFilesGoToLine({
      canEdit: false,
      textViewMode: 'edit',
      isMobile: false,
      focus: openFocus,
    })).toBe(false);
    expect(shouldOpenFilesGoToLine({
      canEdit: true,
      textViewMode: 'edit',
      isMobile: false,
      focus: { ...openFocus, inDialog: true },
    })).toBe(false);
    expect(shouldOpenFilesGoToLine({
      canEdit: true,
      textViewMode: 'edit',
      isMobile: false,
      focus: { ...openFocus, typingOutsideEditor: true, inEditor: false },
    })).toBe(false);
    expect(shouldOpenFilesGoToLine({
      canEdit: true,
      textViewMode: 'edit',
      isMobile: false,
      focus: { ...openFocus, inEditorRoot: false },
    })).toBe(false);
  });

  test('opens when Files edit has a live editor even if Alt stole focus to the menu bar', () => {
    expect(shouldOpenFilesGoToLine({
      canEdit: true,
      textViewMode: 'edit',
      isMobile: false,
      hasEditor: true,
      focus: {
        inDialog: false,
        inEditor: false,
        inEditorRoot: false,
        typingOutsideEditor: false,
      },
    })).toBe(true);
  });

  test('still rejects the composer CodeMirror when Files has an editor', () => {
    expect(shouldOpenFilesGoToLine({
      canEdit: true,
      textViewMode: 'edit',
      isMobile: false,
      hasEditor: true,
      focus: {
        inDialog: false,
        inEditor: true,
        inEditorRoot: false,
        typingOutsideEditor: false,
      },
    })).toBe(false);
  });
});

describe('resolveFilesGoToLineFocus', () => {
  test('treats a caret in .cm-content as an editor target inside the wrapper', () => {
    const root = new StubElement('DIV');
    const editor = new StubElement('DIV', { className: 'cm-editor', parent: root });
    const content = new StubElement('DIV', { className: 'cm-content', parent: editor, role: 'textbox' });

    expect(resolveFilesGoToLineFocus(content as unknown as EventTarget, root as unknown as Node)).toEqual({
      inDialog: false,
      inEditor: true,
      inEditorRoot: true,
      typingOutsideEditor: false,
    });
  });

  test('rejects a composer input even when a files editor exists', () => {
    const root = new StubElement('DIV');
    new StubElement('DIV', { className: 'cm-editor', parent: root });
    const composer = new StubElement('TEXTAREA');

    expect(resolveFilesGoToLineFocus(composer as unknown as EventTarget, root as unknown as Node)).toEqual({
      inDialog: false,
      inEditor: false,
      inEditorRoot: false,
      typingOutsideEditor: true,
    });
  });
});

describe('isUndeliveredShortcutEventTarget', () => {
  test('treats null and non-Node placeholders as undelivered invoke targets', () => {
    expect(isUndeliveredShortcutEventTarget(null)).toBe(true);
    expect(isUndeliveredShortcutEventTarget({} as EventTarget)).toBe(true);
  });
});

describe('shouldOpenFilesGoToLineWithoutFocus', () => {
  test('opens a synthetic menu invoke when this files editor is live', () => {
    expect(shouldOpenFilesGoToLineWithoutFocus({
      canEdit: true,
      textViewMode: 'edit',
      isMobile: false,
      hasEditor: true,
      eventTarget: null,
    })).toBe(true);
  });

  test('opens an untrusted invoke even when Chromium leaves a non-null placeholder target', () => {
    expect(shouldOpenFilesGoToLineWithoutFocus({
      canEdit: true,
      textViewMode: 'edit',
      isMobile: false,
      hasEditor: true,
      eventTarget: {} as EventTarget,
      isTrusted: false,
    })).toBe(true);
  });

  test('does not treat a trusted real keydown as a menu invoke', () => {
    expect(shouldOpenFilesGoToLineWithoutFocus({
      canEdit: true,
      textViewMode: 'edit',
      isMobile: false,
      hasEditor: true,
      eventTarget: {} as EventTarget,
      isTrusted: true,
    })).toBe(false);
  });
});

describe('consumeGoToLineSubmitKey', () => {
  test('consumes Enter so a parent menu cannot swallow submit', () => {
    const calls: string[] = [];
    const event = {
      key: 'Enter',
      preventDefault: () => calls.push('preventDefault'),
      stopPropagation: () => calls.push('stopPropagation'),
      stopImmediatePropagation: () => calls.push('stopImmediatePropagation'),
    };

    expect(consumeGoToLineSubmitKey(event)).toBe(true);
    expect(calls).toEqual(['preventDefault', 'stopPropagation', 'stopImmediatePropagation']);
  });

  test('leaves other keys alone', () => {
    let prevented = false;
    expect(consumeGoToLineSubmitKey({
      key: 'Escape',
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {
        prevented = true;
      },
    })).toBe(false);
    expect(prevented).toBe(false);
  });
});

describe('Files go-to-line wiring', () => {
  test('Alt+G reveals the kebab Line field, including editor-only FilesView', () => {
    expect(filesViewSource).toContain("useKeybind('open_go_to_line'");
    expect(filesViewSource).toContain('shouldOpenFilesGoToLine');
    expect(filesViewSource).toContain('hasEditor');
    expect(filesViewSource).toContain('isTrusted: event.isTrusted');
    expect(filesViewSource).toContain('revealGoToLineField');
    expect(filesViewSource).toContain('setIsFloatingToolbarOpen(true)');
    expect(filesViewSource).toContain('mode?: \'full\' | \'editor-only\'');
    expect(filesViewSource).toContain('<GoToLineDialog');
    expect(filesViewSource).toContain('variant="inline"');
    expect(menuActionsSource).toContain("shortcutRegistry.invoke('open_go_to_line')");
  });

  test('Enter in the Line field is captured before a parent menu can close', () => {
    expect(goToLineSource).toContain('consumeGoToLineSubmitKey');
    expect(goToLineSource).toContain("document.addEventListener('keydown', handleKeyDown, true)");
    expect(goToLineSource).toContain('onSubmit');
    expect(goToLineSource).toContain('type="submit"');
    expect(goToLineSource).toContain('view.focus()');

    const listenerStart = goToLineSource.indexOf('const handleKeyDown = (event: KeyboardEvent) => {');
    expect(listenerStart).toBeGreaterThan(-1);
    const listener = goToLineSource.slice(
      listenerStart,
      goToLineSource.indexOf('document.addEventListener(\'keydown\'', listenerStart),
    );
    expect(listener).toContain('consumeGoToLineSubmitKey(event)');
    expect(listener).toContain('handleSubmit()');
    expect(listener.indexOf('consumeGoToLineSubmitKey')).toBeLessThan(listener.indexOf("event.key !== 'Escape'"));
  });
});
