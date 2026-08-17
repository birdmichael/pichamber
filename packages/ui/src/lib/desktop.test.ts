import { describe, expect, test } from 'bun:test';

import { isBrowserClientRuntime, saveDesktopImageFile } from './desktop';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

const withLocalDesktopBridge = async <T>(
  handler: (cmd: string, args: Record<string, unknown>) => unknown | Promise<unknown>,
  run: () => Promise<T>,
): Promise<T> => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __OPENCHAMBER_ELECTRON__: { runtime: 'electron' },
      __OPENCHAMBER_DESKTOP__: { invoke: handler },
      __OPENCHAMBER_LOCAL_ORIGIN__: 'http://127.0.0.1:3901',
      __OPENCHAMBER_API_BASE_URL__: 'http://127.0.0.1:3901',
      location: { origin: 'http://127.0.0.1:3901', hostname: '127.0.0.1' },
    },
  });
  try {
    return await run();
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
};

describe('browser client runtime', () => {
  test('uses browser file behavior only outside the Electron shell', () => {
    expect(isBrowserClientRuntime('web', false)).toBe(true);
    expect(isBrowserClientRuntime('web', true)).toBe(false);
  });

  test('keeps desktop and VS Code runtime behavior out of browser-only flows', () => {
    expect(isBrowserClientRuntime('desktop', false)).toBe(false);
    expect(isBrowserClientRuntime('vscode', false)).toBe(false);
  });
});

describe('saveDesktopImageFile', () => {
  test('returns null when desktop invoke is unavailable', async () => {
    expect(await saveDesktopImageFile('message-1.png', PNG_DATA_URL)).toBeNull();
  });

  test('invokes desktop_save_image and returns the written path', async () => {
    const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
    const path = await withLocalDesktopBridge(async (cmd, args) => {
      calls.push({ cmd, args });
      return '/tmp/message-1.png';
    }, () => saveDesktopImageFile('message-1.png', PNG_DATA_URL));

    expect(path).toBe('/tmp/message-1.png');
    expect(calls).toEqual([{
      cmd: 'desktop_save_image',
      args: { defaultFileName: 'message-1.png', dataUrl: PNG_DATA_URL },
    }]);
  });

  test('returns null when the save dialog is canceled', async () => {
    const path = await withLocalDesktopBridge(async () => null, () => (
      saveDesktopImageFile('message-1.png', PNG_DATA_URL)
    ));
    expect(path).toBeNull();
  });

  test('rethrows a write failure from the main process', async () => {
    await expect(withLocalDesktopBridge(async () => {
      throw new Error('disk full');
    }, () => saveDesktopImageFile('message-1.png', PNG_DATA_URL))).rejects.toThrow('disk full');
  });
});

