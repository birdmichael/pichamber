import { describe, expect, test } from 'bun:test';

import { shouldChainWheelToParent } from './editor-wheel';

describe('editor wheel chaining', () => {
  const scroller = { scrollTop: 40, clientHeight: 200, scrollHeight: 400 };

  test('keeps the wheel inside the editor while it can still scroll', () => {
    expect(shouldChainWheelToParent(scroller, 20)).toBe(false);
    expect(shouldChainWheelToParent(scroller, -20)).toBe(false);
  });

  test('chains to the page at the top and bottom ends', () => {
    expect(shouldChainWheelToParent({ scrollTop: 0, clientHeight: 200, scrollHeight: 400 }, -20)).toBe(true);
    expect(shouldChainWheelToParent({ scrollTop: 200, clientHeight: 200, scrollHeight: 400 }, 20)).toBe(true);
  });

  test('does not chain a stationary wheel', () => {
    expect(shouldChainWheelToParent({ scrollTop: 0, clientHeight: 200, scrollHeight: 400 }, 0)).toBe(false);
  });
});
