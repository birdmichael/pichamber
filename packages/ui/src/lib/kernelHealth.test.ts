import { describe, expect, test } from 'bun:test';
import { isLocalKernelReady, resolveKernelDownMessage } from './kernelHealth';

describe('isLocalKernelReady', () => {
  test('treats Pi kernelReady as ready without OpenCode flags', () => {
    expect(isLocalKernelReady({
      kernel: 'pi',
      status: 'ok',
      kernelReady: true,
      piRunning: true,
      openCodeRunning: false,
      isOpenCodeReady: false,
    })).toBe(true);
  });

  test('treats kernel=pi and status=ok as ready when flags are omitted', () => {
    expect(isLocalKernelReady({
      kernel: 'pi',
      status: 'ok',
      openCodeRunning: false,
      isOpenCodeReady: false,
    })).toBe(true);
  });

  test('does not treat a Pi health payload as ready when the kernel is down', () => {
    expect(isLocalKernelReady({
      kernel: 'pi',
      status: 'error',
      kernelReady: false,
      piRunning: false,
      openCodeRunning: false,
      isOpenCodeReady: false,
    })).toBe(false);
  });

  test('keeps leftover OpenCode readiness on the OpenCode kernel', () => {
    expect(isLocalKernelReady({
      kernel: 'opencode',
      status: 'ok',
      openCodeRunning: true,
      isOpenCodeReady: true,
    })).toBe(true);
    expect(isLocalKernelReady({
      kernel: 'opencode',
      status: 'ok',
      openCodeRunning: false,
      isOpenCodeReady: false,
    })).toBe(false);
  });

  test('rejects missing or non-object health payloads', () => {
    expect(isLocalKernelReady(null)).toBe(false);
    expect(isLocalKernelReady(undefined)).toBe(false);
  });
});

describe('resolveKernelDownMessage', () => {
  test('prefers Pi node runtime message and recovery over a generic process-down line', () => {
    expect(resolveKernelDownMessage({
      kernel: 'pi',
      kernelReady: false,
      piNodeRuntime: {
        ok: false,
        message: 'Desktop could not find a Node.js binary for the Pi kernel.',
        recovery: 'Set PICHAMBER_NODE_BINARY, then reload Pi.',
      },
    }, 'Pi kernel is not running')).toBe(
      'Desktop could not find a Node.js binary for the Pi kernel. Set PICHAMBER_NODE_BINARY, then reload Pi.',
    );
  });

  test('keeps lastOpenCodeError when the leftover OpenCode process failed', () => {
    expect(resolveKernelDownMessage({
      kernel: 'opencode',
      lastOpenCodeError: 'OpenCode exited with code 1',
    }, 'OpenCode process is not running')).toBe('OpenCode exited with code 1');
  });
});
