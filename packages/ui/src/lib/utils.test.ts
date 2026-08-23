import { describe, expect, test } from 'bun:test';

import { getOpenInFolderLabelKey, getRevealLabelKey } from './utils';

const withUserAgent = <T>(userAgent: string, run: () => T): T => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent, platform: '' },
  });
  try {
    return run();
  } finally {
    if (previousNavigator) {
      Object.defineProperty(globalThis, 'navigator', previousNavigator);
    } else {
      Reflect.deleteProperty(globalThis, 'navigator');
    }
  }
};

describe('platform folder chrome labels', () => {
  test('Linux uses File Manager for reveal and open-in', () => {
    withUserAgent('Mozilla/5.0 (X11; Linux x86_64)', () => {
      expect(getRevealLabelKey()).toBe('common.revealPath.fileManager');
      expect(getOpenInFolderLabelKey()).toBe('common.revealPath.fileManager');
    });
  });

  test('Windows uses File Explorer', () => {
    withUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', () => {
      expect(getRevealLabelKey()).toBe('common.revealPath.fileExplorer');
      expect(getOpenInFolderLabelKey()).toBe('common.revealPath.fileExplorer');
    });
  });

  test('macOS keeps Finder wording, including Open in Finder', () => {
    withUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', () => {
      expect(getRevealLabelKey()).toBe('common.revealPath.finder');
      expect(getOpenInFolderLabelKey()).toBe('directoryExplorerDialog.actions.openInFinder');
    });
  });
});
