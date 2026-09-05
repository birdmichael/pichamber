import { expect, test } from 'bun:test';

import { beginNativeFilePicker, resetNativeFilePickerForTests } from './native-file-picker';
import {
  hasOpenSettingsOverlay,
  hasSettingsEscapeForm,
  isEventInsideSettingsView,
  isInsideSettingsDialog,
  markSettingsOpenedFromTrigger,
  notifySettingsEscapeForm,
  resetSettingsOpenedFromTriggerForTests,
  SETTINGS_ESCAPE_FORM_EVENT,
  shouldBlockSettingsDismiss,
  shouldRenderSettingsWindow,
} from './settings-dismiss';

function withDocument(value: unknown, run: () => void): void {
  const originalDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value,
  });
  try {
    run();
  } finally {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    });
  }
}

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

test('treats the Settings window popup as the Settings dialog', () => {
  const settingsView = {};
  const popup = {
    closest(selector: string) {
      if (selector === '[role="dialog"]') return this;
      return null;
    },
    querySelector: (selector: string) => (
      selector === '[data-settings-view="true"]' ? settingsView : null
    ),
  };

  expect(isInsideSettingsDialog(popup as unknown as EventTarget)).toBe(true);
  expect(isInsideSettingsDialog({
    closest: (selector: string) => (selector === '[data-settings-view="true"]' ? settingsView : null),
  } as unknown as EventTarget)).toBe(true);
});

test('does not treat a nested dialog as the Settings window', () => {
  const nested = {
    closest: (selector: string) => (selector === '[role="dialog"]' ? nested : null),
    querySelector: () => null,
  };

  expect(isInsideSettingsDialog(nested as unknown as EventTarget)).toBe(false);
  expect(isInsideSettingsDialog(null)).toBe(false);
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
  resetSettingsOpenedFromTriggerForTests();
  const form = {} as Element;
  withDocument({
    querySelector: (selector: string) => (
      selector.includes('[data-settings-escape-form]') ? form : null
    ),
  }, () => {
    expect(shouldBlockSettingsDismiss(false, { reason: 'escape-key' })).toBe(true);
  });
});

test('allows Escape to close Settings when no nested overlay is open', () => {
  resetNativeFilePickerForTests();
  resetSettingsOpenedFromTriggerForTests();
  withDocument({
    querySelector: () => null,
    querySelectorAll: () => ({ length: 1 }),
  }, () => {
    expect(shouldBlockSettingsDismiss(false, { reason: 'escape-key' })).toBe(false);
  });
});

test('does not treat leftover role=dialog chrome as a nested Settings dialog', () => {
  resetNativeFilePickerForTests();
  resetSettingsOpenedFromTriggerForTests();
  withDocument({
    querySelector: () => null,
    querySelectorAll: () => ({ length: 2 }),
  }, () => {
    expect(shouldBlockSettingsDismiss(false, { reason: 'escape-key' })).toBe(false);
  });
});

test('blocks Escape when a nested Settings dialog is open', () => {
  resetNativeFilePickerForTests();
  resetSettingsOpenedFromTriggerForTests();
  const nested = {} as Element;
  const settingsDialog = {
    hasAttribute: (name: string) => name === 'data-nested-dialog-open',
    querySelector: () => null,
    closest: () => settingsDialog,
  };
  const settingsView = {
    closest: (selector: string) => (selector === '[role="dialog"]' ? settingsDialog : null),
  };
  withDocument({
    querySelector: (selector: string) => (
      selector === '[data-settings-view="true"]' ? settingsView : null
    ),
  }, () => {
    expect(shouldBlockSettingsDismiss(false, { reason: 'escape-key' })).toBe(true);
  });

  const settingsDialogWithContent = {
    hasAttribute: () => false,
    querySelector: (selector: string) => (
      selector.includes('[data-slot="dialog-content"]') ? nested : null
    ),
    closest: () => settingsDialogWithContent,
  };
  const settingsViewWithContent = {
    closest: (selector: string) => (
      selector === '[role="dialog"]' ? settingsDialogWithContent : null
    ),
  };
  withDocument({
    querySelector: (selector: string) => (
      selector === '[data-settings-view="true"]' ? settingsViewWithContent : null
    ),
  }, () => {
    expect(shouldBlockSettingsDismiss(false, { reason: 'escape-key' })).toBe(true);
  });
});

test('unrelated document dialog-content does not block Settings Escape', () => {
  resetNativeFilePickerForTests();
  resetSettingsOpenedFromTriggerForTests();
  const settingsDialog = {
    hasAttribute: () => false,
    querySelector: () => null,
    closest: () => settingsDialog,
  };
  const settingsView = {
    closest: (selector: string) => (selector === '[role="dialog"]' ? settingsDialog : null),
  };
  withDocument({
    querySelector: (selector: string) => {
      if (selector === '[data-settings-view="true"]') return settingsView;
      if (selector.includes('[data-slot="dialog-content"]')) return {};
      return null;
    },
  }, () => {
    expect(shouldBlockSettingsDismiss(false, { reason: 'escape-key' })).toBe(false);
  });
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
  } as unknown as ParentNode;

  expect(notifySettingsEscapeForm(root)).toBe(true);
  expect(dispatched).toEqual([SETTINGS_ESCAPE_FORM_EVENT]);

  const nestedRoot = {
    querySelector: (selector: string) => {
      if (selector.includes('[data-slot="dialog-content"]')) return {};
      if (selector.includes('[data-settings-escape-form]')) return form;
      return null;
    },
  } as unknown as ParentNode;
  expect(notifySettingsEscapeForm(nestedRoot)).toBe(false);
});

test('allows an explicit close when nothing is blocking', () => {
  resetNativeFilePickerForTests();
  resetSettingsOpenedFromTriggerForTests();
  expect(shouldBlockSettingsDismiss(false, { reason: 'close-press' })).toBe(false);
  expect(shouldBlockSettingsDismiss(true)).toBe(false);
});

test('blocks the leftover outside-press that follows opening Settings', () => {
  resetNativeFilePickerForTests();
  resetSettingsOpenedFromTriggerForTests();
  markSettingsOpenedFromTrigger();
  expect(shouldBlockSettingsDismiss(false, {
    reason: 'outside-press',
    event: { target: null },
  })).toBe(true);
});

test('blocks leftover trigger-press and imperative-action from the same gear click', () => {
  resetNativeFilePickerForTests();
  resetSettingsOpenedFromTriggerForTests();
  markSettingsOpenedFromTrigger();
  expect(shouldBlockSettingsDismiss(false, { reason: 'trigger-press' })).toBe(true);
  expect(shouldBlockSettingsDismiss(false, { reason: 'imperative-action' })).toBe(true);
  expect(shouldBlockSettingsDismiss(false, { reason: 'close-press' })).toBe(false);
});

test('allows Escape during the leftover first-click guard', () => {
  resetNativeFilePickerForTests();
  resetSettingsOpenedFromTriggerForTests();
  markSettingsOpenedFromTrigger();
  withDocument({
    querySelector: () => null,
  }, () => {
    expect(shouldBlockSettingsDismiss(false, { reason: 'escape-key' })).toBe(false);
    expect(shouldBlockSettingsDismiss(false, { reason: 'trigger-press' })).toBe(true);
  });
});

test('renders the Settings window on the same open as the first gear click', () => {
  expect(shouldRenderSettingsWindow(true, false)).toBe(true);
  expect(shouldRenderSettingsWindow(false, false)).toBe(false);
  expect(shouldRenderSettingsWindow(false, true)).toBe(true);
});
