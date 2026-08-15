import { describe, expect, it } from 'bun:test';

import { applyDesktopKernelEnv, resolveDesktopKernelName } from './kernel-env.mjs';

describe('resolveDesktopKernelName', () => {
  it('defaults the Mac desktop kernel to Pi', () => {
    expect(resolveDesktopKernelName({})).toBe('pi');
    expect(resolveDesktopKernelName({ OPENCHAMBER_KERNEL: '' })).toBe('pi');
    expect(resolveDesktopKernelName({ OPENCHAMBER_KERNEL: '  pichamber  ' })).toBe('pi');
  });

  it('keeps an explicit OpenCode override', () => {
    expect(resolveDesktopKernelName({ OPENCHAMBER_KERNEL: 'opencode' })).toBe('opencode');
  });
});

describe('applyDesktopKernelEnv', () => {
  it('writes the resolved kernel back onto the env object', () => {
    const env = {};
    expect(applyDesktopKernelEnv(env)).toBe('pi');
    expect(env.OPENCHAMBER_KERNEL).toBe('pi');
  });
});
