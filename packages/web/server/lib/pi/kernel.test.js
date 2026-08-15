import { describe, expect, it } from 'vitest';

import { isPiKernelEnabled, isPiMockEnabled, resolveKernelName } from './kernel.js';

describe('kernel flags', () => {
  it('defaults to pi', () => {
    expect(resolveKernelName({})).toBe('pi');
    expect(isPiKernelEnabled({})).toBe(true);
  });

  it('can restore the OpenCode kernel', () => {
    expect(isPiKernelEnabled({ OPENCHAMBER_KERNEL: 'opencode' })).toBe(false);
  });

  it('enables mock mode from env', () => {
    expect(isPiMockEnabled({})).toBe(false);
    expect(isPiMockEnabled({ OPENCHAMBER_PI_MOCK: '1' })).toBe(true);
  });
});
