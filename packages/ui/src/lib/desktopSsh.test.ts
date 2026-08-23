import { describe, expect, test } from 'bun:test';
import { createDesktopSshInstance, desktopSshInstancesGet } from './desktopSsh';

const withDesktopBridge = async <T>(
  handler: (cmd: string, args?: Record<string, unknown>) => unknown | Promise<unknown>,
  run: () => Promise<T>,
): Promise<T> => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __OPENCHAMBER_DESKTOP__: {
        invoke: handler,
      },
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

describe('createDesktopSshInstance', () => {
  test('defaults to a managed auto install on loopback', () => {
    expect(createDesktopSshInstance('ssh-1', 'ssh work').remoteOpenchamber).toEqual({
      mode: 'managed',
      keepRunning: true,
      bindHost: '127.0.0.1',
      installMethod: 'auto',
      uploadBundleOverSsh: false,
    });
  });
});

describe('desktopSshInstancesGet', () => {
  test('reads leftover download_release as auto and fills bindHost', async () => {
    const config = await withDesktopBridge(async (cmd) => {
      expect(cmd).toBe('desktop_ssh_instances_get');
      return {
        instances: [{
          id: 'ssh-1',
          sshCommand: 'ssh work',
          remoteOpenchamber: { installMethod: 'download_release' },
        }],
      };
    }, () => desktopSshInstancesGet());

    expect(config.instances).toHaveLength(1);
    expect(config.instances[0]?.remoteOpenchamber.installMethod).toBe('auto');
    expect(config.instances[0]?.remoteOpenchamber.bindHost).toBe('127.0.0.1');
  });

  test('keeps an explicit bun install and LAN bind host', async () => {
    const config = await withDesktopBridge(async () => ({
      instances: [{
        id: 'ssh-2',
        sshCommand: 'ssh lab',
        remoteOpenchamber: {
          mode: 'managed',
          installMethod: 'bun',
          bindHost: '0.0.0.0',
        },
      }],
    }), () => desktopSshInstancesGet());

    expect(config.instances[0]?.remoteOpenchamber).toMatchObject({
      installMethod: 'bun',
      bindHost: '0.0.0.0',
    });
  });
});
