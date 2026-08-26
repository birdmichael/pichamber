import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGracefulShutdownRuntime } from './shutdown-runtime.js';

const createRuntime = (server) => createGracefulShutdownRuntime({
  process: { exit: vi.fn() },
  shutdownTimeoutMs: 1000,
  getExitOnShutdown: () => false,
  getIsShuttingDown: () => false,
  setIsShuttingDown: vi.fn(),
  syncToHmrState: vi.fn(),
  openCodeWatcherRuntime: { stop: vi.fn() },
  sessionRuntime: { dispose: vi.fn() },
  scheduledTasksRuntime: { stop: vi.fn() },
  getHealthCheckInterval: () => null,
  clearHealthCheckInterval: vi.fn(),
  getTerminalRuntime: () => null,
  setTerminalRuntime: vi.fn(),
  getMessageStreamRuntime: () => null,
  setMessageStreamRuntime: vi.fn(),
  shouldSkipOpenCodeStop: () => true,
  getOpenCodePort: () => null,
  getOpenCodeProcess: () => null,
  setOpenCodeProcess: vi.fn(),
  killProcessOnPort: vi.fn(),
  waitForPortRelease: vi.fn(async () => true),
  getServer: () => server,
  getUiAuthController: () => null,
  setUiAuthController: vi.fn(),
  getActiveTunnelController: () => null,
  setActiveTunnelController: vi.fn(),
  tunnelAuthController: { clearActiveTunnel: vi.fn() },
});

describe('graceful shutdown runtime', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('clears the server close timeout when the server closes first', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const server = {
      close: vi.fn((callback) => {
        callback();
      }),
    };

    const runtime = createRuntime(server);
    await runtime.gracefulShutdown({ exitProcess: false });

    await vi.advanceTimersByTimeAsync(1000);

    expect(warnSpy).not.toHaveBeenCalledWith('Server close timeout reached, forcing shutdown');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('disposes the Pi kernel before the leftover OpenCode session runtime', async () => {
    const order = [];
    const dispose = vi.fn(() => {
      order.push('kernel');
    });
    const sessionRuntime = { dispose: vi.fn(() => { order.push('sessions'); }) };
    const runtime = createGracefulShutdownRuntime({
      process: { exit: vi.fn() },
      shutdownTimeoutMs: 1000,
      getExitOnShutdown: () => false,
      getIsShuttingDown: () => false,
      setIsShuttingDown: vi.fn(),
      syncToHmrState: vi.fn(),
      openCodeWatcherRuntime: { stop: vi.fn() },
      sessionRuntime,
      scheduledTasksRuntime: { stop: vi.fn() },
      getHealthCheckInterval: () => null,
      clearHealthCheckInterval: vi.fn(),
      getTerminalRuntime: () => null,
      setTerminalRuntime: vi.fn(),
      getMessageStreamRuntime: () => null,
      setMessageStreamRuntime: vi.fn(),
      shouldSkipOpenCodeStop: () => true,
      getOpenCodePort: () => null,
      getOpenCodeProcess: () => null,
      setOpenCodeProcess: vi.fn(),
      killProcessOnPort: vi.fn(),
      waitForPortRelease: vi.fn(async () => true),
      getServer: () => ({ close: (callback) => callback() }),
      getUiAuthController: () => null,
      setUiAuthController: vi.fn(),
      getActiveTunnelController: () => null,
      setActiveTunnelController: vi.fn(),
      tunnelAuthController: { clearActiveTunnel: vi.fn() },
      getPiKernel: () => ({ dispose }),
    });

    await runtime.gracefulShutdown({ exitProcess: false });

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(sessionRuntime.dispose).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['kernel', 'sessions']);
  });
});
