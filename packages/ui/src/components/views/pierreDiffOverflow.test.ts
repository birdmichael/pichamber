import { describe, expect, test } from 'bun:test';

import { PIERRE_DIFF_OVERFLOW_CSS, resolvePierreOverflow } from './pierreDiffOverflow';

describe('resolvePierreOverflow', () => {
  test('wraps only when the wrap toggle is on', () => {
    expect(resolvePierreOverflow(true)).toBe('wrap');
    expect(resolvePierreOverflow(false)).toBe('scroll');
    expect(resolvePierreOverflow(undefined)).toBe('scroll');
  });
});

describe('PIERRE_DIFF_OVERFLOW_CSS', () => {
  test('makes the horizontal scrollbar thumb visible', () => {
    expect(PIERRE_DIFF_OVERFLOW_CSS).toContain('[data-code]::-webkit-scrollbar-thumb');
    expect(PIERRE_DIFF_OVERFLOW_CSS).toContain('--oc-scrollbar-thumb');
    expect(PIERRE_DIFF_OVERFLOW_CSS).toContain('scrollbar-color');
  });

  test('lets wrapped lines grow instead of clipping at the panel edge', () => {
    expect(PIERRE_DIFF_OVERFLOW_CSS).toContain('[data-overflow="wrap"] [data-code]');
    expect(PIERRE_DIFF_OVERFLOW_CSS).toContain('overflow-y: visible');
    expect(PIERRE_DIFF_OVERFLOW_CSS).toContain('white-space: pre-wrap');
    expect(PIERRE_DIFF_OVERFLOW_CSS).toContain('overflow-wrap: anywhere');
  });
});
