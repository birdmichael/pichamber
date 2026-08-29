import { describe, expect, test } from 'bun:test';

import { isSessionAssistVisibleOnPiKernel } from '@/lib/usePiKernel';

describe('session assist on Pi', () => {
  test('hides leftover OpenChamber Recap and suggestion on the Pi kernel', () => {
    expect(isSessionAssistVisibleOnPiKernel(true)).toBe(false);
  });

  test('keeps leftover OpenChamber Recap on OpenCode', () => {
    expect(isSessionAssistVisibleOnPiKernel(false)).toBe(true);
  });
});
