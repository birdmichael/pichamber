import { afterAll, expect, test } from 'bun:test';

import { hasOpenDropdown, isEditableEventTarget } from './keyboard-shortcut-dom';

test('does not treat an unrelated visible listbox as an open dropdown', () => {
  const promptNavigator = {} as Element;
  const root = {
    querySelector: (selector: string) => selector.includes('[role="listbox"]') ? promptNavigator : null,
  } as unknown as ParentNode;

  expect(hasOpenDropdown(root)).toBe(false);
});

test('detects an open dropdown popup', () => {
  const dropdown = {} as Element;
  const root = {
    querySelector: (selector: string) => selector.includes('[data-slot="dropdown-menu-content"][data-open]') ? dropdown : null,
  } as unknown as ParentNode;

  expect(hasOpenDropdown(root)).toBe(true);
});

test('detects an open select popup', () => {
  const select = {} as Element;
  const root = {
    querySelector: (selector: string) => selector.includes('[data-slot="select-content"][data-open]') ? select : null,
  } as unknown as ParentNode;

  expect(hasOpenDropdown(root)).toBe(true);
});

class StubHTMLElement {
  tagName: string;
  isContentEditable: boolean;
  className: string;
  parentElement: StubHTMLElement | null;
  private contentEditableAttr: string | null;

  constructor(
    tagName: string,
    isContentEditable = false,
    options: { className?: string; parent?: StubHTMLElement | null; contentEditable?: string | null } = {},
  ) {
    this.tagName = tagName;
    this.isContentEditable = isContentEditable;
    this.className = options.className ?? '';
    this.parentElement = options.parent ?? null;
    this.contentEditableAttr = options.contentEditable ?? (isContentEditable ? 'true' : null);
  }

  closest(selector: string): StubHTMLElement | null {
    const parts = selector.split(',').map((part) => part.trim());
    if (parts.some((part) => this.matchesPart(part))) return this;
    return this.parentElement?.closest(selector) ?? null;
  }

  private matchesPart(selector: string): boolean {
    if (selector.startsWith('.')) {
      return this.className.split(/\s+/).includes(selector.slice(1));
    }
    if (selector === '[contenteditable="true"]') {
      return this.contentEditableAttr === 'true';
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }
}

const previousHTMLElement = (globalThis as { HTMLElement?: unknown }).HTMLElement;
(globalThis as { HTMLElement: unknown }).HTMLElement = StubHTMLElement;

const element = (tagName: string, isContentEditable = false) =>
  new StubHTMLElement(tagName, isContentEditable) as unknown as HTMLElement;

test('treats inputs, textareas, selects, and contenteditable elements as editable targets', () => {
  expect(isEditableEventTarget(element('INPUT'))).toBe(true);
  expect(isEditableEventTarget(element('TEXTAREA'))).toBe(true);
  expect(isEditableEventTarget(element('SELECT'))).toBe(true);
  expect(isEditableEventTarget(element('DIV', true))).toBe(true);
});

test('does not treat a plain element or non-element target as editable', () => {
  expect(isEditableEventTarget(element('DIV'))).toBe(false);
  expect(isEditableEventTarget(element('BUTTON'))).toBe(false);
  expect(isEditableEventTarget(null)).toBe(false);
  expect(isEditableEventTarget({} as EventTarget)).toBe(false);
});

test('treats a nested span inside a contenteditable or CodeMirror parent as editable', () => {
  const editableParent = new StubHTMLElement('DIV', true, { contentEditable: 'true' });
  const nestedInEditable = new StubHTMLElement('SPAN', false, { parent: editableParent });
  expect(isEditableEventTarget(nestedInEditable as unknown as HTMLElement)).toBe(true);

  const cmContent = new StubHTMLElement('DIV', false, { className: 'cm-content' });
  const cmLine = new StubHTMLElement('SPAN', false, { className: 'cm-line', parent: cmContent });
  expect(isEditableEventTarget(cmLine as unknown as HTMLElement)).toBe(true);
});

afterAll(() => {
  if (previousHTMLElement) (globalThis as { HTMLElement: unknown }).HTMLElement = previousHTMLElement;
  else Reflect.deleteProperty(globalThis, 'HTMLElement');
});
