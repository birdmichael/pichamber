import { expect, test } from 'bun:test';

import { beginNativeFilePicker, resetNativeFilePickerForTests } from './native-file-picker';
import {
  hasOpenSettingsOverlay,
  hasSettingsEscapeForm,
  isEventInsideSettingsView,
  notifySettingsEscapeForm,
  SETTINGS_ESCAPE_FORM_EVENT,
  shouldBlockSettingsDismiss,
} from './settings-dismiss';

test('detects a nested settings overlay', () => {
  const overlay = {} as Element;
  const root = {
    querySelector: (selector: string) => (
      selector.includes('[data-slot="select-content"][data-open]') ? overlay : null
    ),
  } as unknown as ParentNode;

  expect(hasOpenSettingsOverlay(root)).toBe(true);
});

test('detects a settings-local escape form', () => {
  const form = {} as Element;
  const root = {
    querySelector: (selector: string) => (
      selector.includes('[data-settings-escape-form]') ? form : null
    ),
  } as unknown as ParentNode;

  expect(hasSettingsEscapeForm(root)).toBe(true);
});

test('treats clicks inside the settings view as in-pane', () => {
  const target = {
    closest: (selector: string) => (selector === '[data-settings-view="true"]' ? {} : null),
  } as unknown as Element;

  expect(isEventInsideSettingsView(target)).toBe(true);
  expect(isEventInsideSettingsView(null)).toBe(false);
});

test('blocks dismiss while a native picker is open', () => {
  resetNativeFilePickerForTests();
  beginNativeFilePicker();
  try {
    expect(shouldBlockSettingsDismiss(false, { reason: 'focus-out' })).toBe(true);
  } finally {
    resetNativeFilePickerForTests();
  }
});

test('blocks an outside-press that originates inside the settings view', () => {
  resetNativeFilePickerForTests();
  const target = {
    closest: (selector: string) => (selector === '[data-settings-view="true"]' ? {} : null),
  } as unknown as Element;

  expect(shouldBlockSettingsDismiss(false, {
    reason: 'outside-press',
    event: { target },
  })).toBe(true);
});

test('blocks Escape when a settings-local form is open', () => {
  resetNativeFilePickerForTests();
  const originalDocument = globalThis.document;
  const form = {} as Element;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      querySelector: (selector: string) => (
        selector.includes('[data-settings-escape-form]') ? form : null
      ),
      querySelectorAll: () => ({ length: 1 }),
    },
  });
  try {
    expect(shouldBlockSettingsDismiss(false, { reason: 'escape-key' })).toBe(true);
  } finally {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    });
  }
});

test('notifies a settings-local escape form and skips nested dialogs', () => {
  const dispatched: string[] = [];
  const form = {
    dispatchEvent: (event: Event) => {
      dispatched.push(event.type);
      return true;
    },
  };
  const root = {
    querySelector: (selector: string) => (
      selector.includes('[data-settings-escape-form]') ? form : null
    ),
    querySelectorAll: () => ({ length: 1 }),
  } as unknown as ParentNode;

  expect(notifySettingsEscapeForm(root)).toBe(true);
  expect(dispatched).toEqual([SETTINGS_ESCAPE_FORM_EVENT]);

  const nestedRoot = {
    querySelector: (selector: string) => (
      selector.includes('[data-settings-escape-form]') ? form : null
    ),
    querySelectorAll: () => ({ length: 2 }),
  } as unknown as ParentNode;
  expect(notifySettingsEscapeForm(nestedRoot)).toBe(false);
});

test('allows an explicit close when nothing is blocking', () => {
  resetNativeFilePickerForTests();
  expect(shouldBlockSettingsDismiss(false, { reason: 'close-press' })).toBe(false);
  expect(shouldBlockSettingsDismiss(true)).toBe(false);
});
