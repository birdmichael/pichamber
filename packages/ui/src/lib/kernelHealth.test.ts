import { describe, expect, test } from 'bun:test';
import { isLocalKernelReady } from './kernelHealth';

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
