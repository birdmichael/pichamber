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
  constructor(tagName: string, isContentEditable = false) {
    this.tagName = tagName;
    this.isContentEditable = isContentEditable;
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

afterAll(() => {
  if (previousHTMLElement) (globalThis as { HTMLElement: unknown }).HTMLElement = previousHTMLElement;
  else Reflect.deleteProperty(globalThis, 'HTMLElement');
});
